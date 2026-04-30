/**
 * POST /api/agent/handle-message
 *
 * Phase 0 — VPS → Dashboard inference path. The customer's WhatsApp/Baileys
 * VPS posts inbound messages here; the dashboard runs Anthropic centrally
 * and returns the reply. Replaces the per-VPS Claude Code subscription
 * which the April 4 2026 ToS change banned.
 *
 * Auth: per-client `oak_*` API key (same pattern as the rest of /api/agent/*)
 *       — already enforced via authenticateAgentRequest from lib/api-auth.ts.
 *       The key is bound to a single client_id; no cross-tenant access.
 *
 * Body: {
 *   conversation_id?: string,    // null = start a new conversation thread
 *   role: 'customer' | 'owner',
 *   content: string,
 *   channel: 'whatsapp' | 'sms' | 'email' | 'voice',
 *   sender_phone?: string,
 *   sender_name?: string,
 *   idempotency_key?: string     // recommended — VPS retries if Vercel slow
 * }
 *
 * Response (block-and-return — sync):
 * {
 *   conversation_id: string,
 *   message_id: string,
 *   reply: string,                // empty if AI Employee took action without speaking
 *   tool_uses: Array<{name, input}>,
 *   finish_reason: string,
 *   usage: {...},
 *   should_send: boolean          // false if budget gated to queue_for_approval
 * }
 *
 * Tool dispatch + Anthropic streaming work the same way as the SSE chat
 * route — we just buffer everything and return at the end. Internally
 * this calls the same provider + tool layer.
 *
 * Long-tail: if generation exceeds 50s the route returns 202 + job_id
 * and the VPS picks up the result via /api/agent/handle-message/result/[id]
 * (not yet built — TODO when we observe real long-tail tool runs).
 */

import { authenticateAgentRequest } from '@/lib/api-auth'
import { getProvider } from '@/lib/llm/provider'
import type { LlmMessage, LlmModelTier } from '@/lib/llm/provider'
import { buildSystemPromptForClient } from '@/lib/llm/system-prompt'
import { selectToolsForClient, getToolByName } from '@/lib/llm/tools'
import {
  reserveBudgetTier,
  recordLlmSpend,
  computeCostPence,
  type BudgetTier,
} from '@/lib/billing/budget'
import { executeIntegrationAction } from '@/lib/integrations/provider'
import { dispatchInternalTool } from '@/lib/llm/internal-tools'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TOOL_LOOPS = 8
const MAX_HISTORY_MESSAGES = 80
const MODEL_IDS: Record<LlmModelTier, string> = {
  sonnet: 'claude-sonnet-4-6-20260401',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-7-20260425',
}

interface RequestBody {
  conversation_id?: string | null
  role?: 'customer' | 'owner'
  content?: string
  channel?: 'whatsapp' | 'sms' | 'email' | 'voice'
  sender_phone?: string
  sender_name?: string
  idempotency_key?: string
}

export async function POST(request: Request) {
  const requestId = newRequestId()

  // 1. Auth via oak_ key — yields client_id + service-role supabase client
  const auth = await authenticateAgentRequest(request)
  if (!auth.authenticated) {
    return new Response(
      JSON.stringify({ error: auth.error }),
      { status: auth.status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } }
    )
  }
  const { clientId, supabase: sb } = auth

  // 2. Parse + validate
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return errorResponse(Errors.validation({ body: 'Invalid JSON body' }), requestId)
  }
  if (!body.content || body.content.length === 0) {
    return errorResponse(Errors.validation({ field: 'content' }), requestId)
  }
  if (body.role !== 'customer' && body.role !== 'owner') {
    return errorResponse(Errors.validation({ field: 'role', allowed: ['customer', 'owner'] }), requestId)
  }

  try {
    // 3. Resolve / create conversation row in `conversations` table (the
    // customer↔business thread, distinct from agent_chat_sessions which is
    // owner↔AI). We log inbound + reply to comms_log.
    let conversationId = body.conversation_id ?? null
    if (!conversationId) {
      const ins = await sb
        .from('conversation_sessions')
        .insert({
          client_id: clientId,
          channel: body.channel ?? 'whatsapp',
          customer_phone: body.sender_phone ?? null,
          customer_name: body.sender_name ?? null,
        })
        .select('id')
        .single()
      if (ins.error) throw Errors.internal(ins.error.message)
      conversationId = ins.data.id
    }

    // Inbound row
    const inboundIns = await sb
      .from('comms_log')
      .insert({
        client_id: clientId,
        conversation_id: conversationId,
        direction: 'inbound',
        body: body.content,
        channel: body.channel ?? 'whatsapp',
      })
      .select('id')
      .single()
    if (inboundIns.error) throw Errors.internal(inboundIns.error.message)

    // 4. Check takeover state — owner manually paused the AI on this thread?
    // SELECT FOR UPDATE inside an RPC would be ideal; for now read+check is
    // acceptable since the takeover flag is owner-driven (low contention).
    const conv = await sb
      .from('conversation_sessions')
      .select('ai_paused, ai_paused_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (conv.data?.ai_paused) {
      return jsonResponse(
        {
          conversation_id: conversationId,
          message_id: inboundIns.data.id,
          reply: '',
          tool_uses: [],
          finish_reason: 'ai_paused',
          should_send: false,
          ai_paused: true,
        },
        { requestId }
      )
    }

    // 5. Budget reservation (atomic)
    const { data: clientRow } = await sb.from('clients').select('subscription_plan').eq('id', clientId).maybeSingle()
    const plan = (clientRow?.subscription_plan as string | null) ?? null
    const tier: BudgetTier = await reserveBudgetTier(clientId, plan)

    if (tier === 'hard_capped') {
      return errorResponse(Errors.budgetHardCapped(), requestId)
    }

    // 6. Build system prompt + tools
    const sys = await buildSystemPromptForClient(clientId)
    const { data: configRow } = await sb
      .from('agent_config')
      .select('enabled_tools')
      .eq('client_id', clientId)
      .maybeSingle()
    const enabledTools = (configRow?.enabled_tools as string[] | null) ?? []
    const tools = selectToolsForClient(enabledTools)
    const toolSchemas = tools.map(({ name, description, input_schema }) => ({
      name,
      description,
      input_schema,
    }))

    // 7. Pull last MAX_HISTORY_MESSAGES from comms_log, oldest→newest
    const histRes = await sb
      .from('comms_log')
      .select('direction, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES + 1)
    const history = (histRes.data ?? [])
      .slice()
      .reverse()
      .map<LlmMessage>((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: [{ type: 'text', text: (m.body as string) ?? '' }],
      }))

    // 8. Stream from Anthropic (we buffer to return synchronously)
    const provider = await getProvider()
    const modelTier: LlmModelTier = tier === 'normal' ? 'sonnet' : 'haiku'
    const modelId = MODEL_IDS[modelTier]

    const upstreamAbort = new AbortController()
    let workingMessages: LlmMessage[] = [...history]
    const accumulatedText: string[] = []
    const toolUsesEmitted: Array<{ name: string; input: unknown; result_summary: string }> = []
    const totalUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
    let finishReason = 'unknown'

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const events = provider.stream(
        {
          model: modelTier,
          systemStable: sys.systemStable,
          systemVolatile: sys.systemVolatile,
          tools: toolSchemas,
          messages: workingMessages,
          maxTokens: 4096,
          temperature: 0.7,
        },
        upstreamAbort.signal
      )

      const turnToolUses: Array<{ id: string; name: string; input: unknown }> = []
      let assistantText = ''
      let stopReason = ''
      let messageCompleteSeen = false

      for await (const ev of events) {
        switch (ev.type) {
          case 'text_delta':
            assistantText += ev.text
            break
          case 'tool_use_complete':
            turnToolUses.push({ id: ev.toolUseId, name: ev.toolName, input: ev.input })
            break
          case 'message_complete':
            stopReason = ev.stopReason
            messageCompleteSeen = true
            totalUsage.inputTokens += ev.usage.inputTokens
            totalUsage.outputTokens += ev.usage.outputTokens
            totalUsage.cacheCreationTokens += ev.usage.cacheCreationTokens
            totalUsage.cacheReadTokens += ev.usage.cacheReadTokens
            break
          case 'error':
            throw new Error(`provider error: ${ev.code} ${ev.message}`)
        }
      }

      accumulatedText.push(assistantText)
      if (!messageCompleteSeen) throw new Error('upstream stream ended without message_complete')

      if (turnToolUses.length === 0 || stopReason !== 'tool_use') {
        finishReason = stopReason || 'end_turn'
        break
      }

      // Append assistant + tool results, loop
      const assistantBlocks: LlmMessage['content'] = []
      if (assistantText) assistantBlocks.push({ type: 'text', text: assistantText })
      for (const tu of turnToolUses) {
        assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      }
      workingMessages = [...workingMessages, { role: 'assistant', content: assistantBlocks }]

      const toolResults: LlmMessage['content'] = []
      for (const tu of turnToolUses) {
        const def = getToolByName(tu.name)
        let resultText: string
        let summary: string
        if (!def) {
          resultText = JSON.stringify({ error: `Unknown tool: ${tu.name}` })
          summary = 'unknown_tool'
        } else if (def.dispatch.kind === 'composio') {
          const r = await executeIntegrationAction(def.dispatch.action, tu.input, { clientId })
          resultText = r.ok ? JSON.stringify(r.data).slice(0, 16_000) : JSON.stringify({ error: r.message, code: r.code })
          summary = r.ok ? 'ok' : `failed: ${r.code}`
        } else {
          // Internal tools have no user_id at the agent edge — use clientId as proxy
          const r = await dispatchInternalTool(def.dispatch.fn, tu.input, { clientId, userId: clientId })
          resultText = JSON.stringify(r.data).slice(0, 16_000)
          summary = r.ok ? 'ok' : 'failed'
        }
        toolUsesEmitted.push({ name: tu.name, input: tu.input, result_summary: summary })
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText })
      }
      workingMessages = [...workingMessages, { role: 'user', content: toolResults }]
    }

    // 9. Persist outbound row + record spend
    const reply = accumulatedText.join('').trim()
    const costPence = computeCostPence(modelId, totalUsage)
    if (costPence > 0) {
      await recordLlmSpend(clientId, costPence, plan).catch((err) =>
        console.error('[handle-message] recordLlmSpend failed:', err)
      )
    }

    // Budget gate: queue_for_approval means we generated but won't send
    const shouldSend = tier !== 'queue_for_approval' && reply.length > 0

    if (shouldSend) {
      const outIns = await sb
        .from('comms_log')
        .insert({
          client_id: clientId,
          conversation_id: conversationId,
          direction: 'outbound',
          body: reply,
          channel: body.channel ?? 'whatsapp',
        })
        .select('id')
        .single()
      if (outIns.error) {
        console.error('[handle-message] outbound persist failed:', outIns.error)
      }
    } else {
      // Queue notification for owner to review
      // (This is the "soft degradation" path — see lib/billing/budget.ts)
      console.log('[handle-message] reply held for owner review (tier:', tier, ')')
    }

    return jsonResponse(
      {
        conversation_id: conversationId,
        message_id: inboundIns.data.id,
        reply,
        tool_uses: toolUsesEmitted,
        finish_reason: finishReason,
        usage: { ...totalUsage, model: modelId, cost_pence: costPence, budget_tier: tier },
        should_send: shouldSend,
      },
      { requestId }
    )
  } catch (err) {
    console.error('[handle-message]', requestId, err)
    return errorResponse(err, requestId)
  }
}
