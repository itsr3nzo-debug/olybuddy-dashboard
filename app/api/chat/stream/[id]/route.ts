/**
 * GET /api/chat/stream/[id]?token=<jwt>&assistant_message_id=<uuid>
 *
 * SSE chat stream — Anthropic central path.
 *
 * REVISION (DA pass 2): Fixed B2 (spend on error path), B3 (double-close +
 * cleanup race), B4 (scope shadowing), B5 (empty assistant message), B6
 * (tool-loop off-by-one + watchdog), M3 (client dedup), M4 (history
 * truncation), M5 (proper types), M14 (auth error envelope).
 *
 * Wire format:
 *   : heartbeat                 (every 15s)
 *   event: message_start        data: { message_id, model, started_at, budget_tier }
 *   event: token                data: { content }
 *   event: tool_use_start       data: { tool_use_id, tool_name }
 *   event: tool_use_delta       data: { tool_use_id, partial_json }
 *   event: tool_use_complete    data: { tool_use_id, tool_name, input }
 *   event: tool_result          data: { tool_use_id, ok, summary }
 *   event: budget_changed       data: { tier, spent_pence, cap_pence }
 *   event: message_complete     data: { message_id, finish_reason, usage }
 *   event: error                data: { code, message, retryable }
 */

import { requireAuthFromQuery, getClientIdFromClaims } from '@/lib/auth/claims'
import { newRequestId, errorResponse, Errors } from '@/lib/api/errors'
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
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 800 // requires Vercel Pro/Enterprise


const MAX_TOOL_LOOPS = 8
const MAX_HISTORY_MESSAGES = 80 // M4 fix — truncate to last 40 turns
const MODEL_IDS: Record<LlmModelTier, string> = {
  sonnet: 'claude-sonnet-4-6-20260401',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-7-20260425',
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()

  const { id: conversationId } = await params
  const url = new URL(request.url)
  const assistantMessageId = url.searchParams.get('assistant_message_id')
  if (!assistantMessageId) {
    return errorResponse(Errors.validation({ field: 'assistant_message_id' }), requestId)
  }

  // DA fix E16: prefer ticket auth over JWT-in-URL. Ticket is short-lived,
  // single-use, scoped to this exact conversation+message pair. JWT path
  // retained for backward-compat with the browser prototype's existing
  // hookup but logs a warning so we can phase it out.
  let userId: string
  let clientId: string
  const ticket = url.searchParams.get('ticket')
  if (ticket) {
    const sb = createUntypedServiceClient()
    const { data, error } = await sb.rpc('consume_sse_ticket', {
      p_ticket: ticket,
      p_scope: 'chat_stream',
    })
    if (error) {
      console.error('[chat/stream] ticket consume failed:', error)
      return errorResponse(Errors.invalidToken(), requestId)
    }
    const row = Array.isArray(data) ? data[0] : data
    const r = row as { user_id?: string; client_id?: string; resource_id?: string } | null
    if (!r || !r.user_id) {
      return errorResponse(Errors.invalidToken(), requestId)
    }
    // Ticket binds to a specific conversation:message pair
    if (r.resource_id !== `${conversationId}:${assistantMessageId}`) {
      return errorResponse(Errors.forbidden('Ticket scope mismatch.'), requestId)
    }
    userId = r.user_id
    clientId = r.client_id ?? ''
  } else {
    // Legacy JWT-in-URL path (logs a warning so we can grep + retire it)
    let claims
    try {
      claims = await requireAuthFromQuery(request)
    } catch (err) {
      return errorResponse(err, requestId)
    }
    console.warn('[chat/stream] legacy JWT-in-URL auth — caller should migrate to ticket')
    userId = claims.sub
    clientId = getClientIdFromClaims(claims)
  }
  void userId // bound for future audit logging

  const sb = createUntypedServiceClient()

  // Fetch session, assistant placeholder, history, agent_config, client.plan
  // — single Promise.all instead of M3's daisy-chain — to halve round-trips.
  const [sessRes, asstRes, histRes, configRes, clientRes] = await Promise.all([
    sb.from('agent_chat_sessions').select('id, client_id').eq('id', conversationId).maybeSingle(),
    sb
      .from('agent_chat_messages')
      .select('id, status')
      .eq('id', assistantMessageId)
      .eq('session_id', conversationId)
      .maybeSingle(),
    sb
      .from('agent_chat_messages')
      .select('id, role, content, status, created_at')
      .eq('session_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES + 1),
    sb.from('agent_config').select('enabled_tools').eq('client_id', clientId).maybeSingle(),
    sb.from('clients').select('subscription_plan').eq('id', clientId).maybeSingle(),
  ])

  if (!sessRes.data || sessRes.data.client_id !== clientId) {
    return errorResponse(Errors.notFound('Conversation not found.'), requestId)
  }
  if (!asstRes.data || asstRes.data.status !== 'pending') {
    return errorResponse(Errors.validation({ field: 'assistant_message_id', state: 'not_awaitable' }), requestId)
  }

  const plan: string | null = clientRes.data?.subscription_plan ?? null
  const enabledTools = (configRes.data?.enabled_tools as string[] | null) ?? []

  // B10 fix — atomic budget read via RPC (single statement, race-safe)
  const initialTier: BudgetTier = await reserveBudgetTier(clientId, plan)

  // History oldest → newest, exclude pending + the placeholder itself
  const historyAsc = (histRes.data ?? [])
    .slice() // copy; .reverse() mutates
    .reverse()
    .filter((m) => m.id !== assistantMessageId && m.status !== 'pending')

  const messages: LlmMessage[] = historyAsc.map(toLlmMessage)

  const encoder = new TextEncoder()
  const upstreamAbort = new AbortController()

  // B3 / B4 fix: single closed-flag, single cleanup, hoisted out of start().
  // Multiple call sites (cancel, finally, abort listener) all converge here
  // and the flag makes every path idempotent.
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  // totalUsage and modelId are visible to BOTH the success and error paths so
  // B2 (spend on error) can record whatever was consumed before failure.
  const totalUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  }
  // Model tier may shift mid-stream if Anthropic emits budget_changed pings;
  // we track the FIRST model used for cost attribution.
  let modelTier: LlmModelTier = initialTier === 'normal' ? 'sonnet' : 'haiku'
  let modelId = MODEL_IDS[modelTier]
  let finishReason = 'unknown'
  const accumulatedText: string[] = []
  const accumulatedToolUses: Array<{ id: string; name: string; input: unknown }> = []

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          /* controller already closed */
        }
      }
      const sendComment = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`))
        } catch {
          /* ignore */
        }
      }

      heartbeat = setInterval(() => sendComment('hb'), 15_000)

      // B5 — refuse to bill if hard-capped before any tokens spent
      if (initialTier === 'hard_capped') {
        send('error', {
          code: 'budget.hard_capped',
          message: 'Usage cap reached. AI Employee paused — contact support.',
          retryable: false,
        })
        await sb
          .from('agent_chat_messages')
          .update({ status: 'error', content: '[Budget hard cap reached]' })
          .eq('id', assistantMessageId)
        return finalize(controller)
      }

      send('message_start', {
        message_id: assistantMessageId,
        model: modelId,
        started_at: new Date().toISOString(),
        budget_tier: initialTier,
      })

      const sys = await buildSystemPromptForClient(clientId)
      const tools = selectToolsForClient(enabledTools)
      const toolSchemas = tools.map(({ name, description, input_schema }) => ({
        name,
        description,
        input_schema,
      }))

      const provider = await getProvider()

      try {
        let workingMessages: LlmMessage[] = [...messages]
        let toolLoops = 0

        // B6 fix — `<` instead of `<=` so MAX_TOOL_LOOPS=8 means exactly 8 turns
        while (toolLoops < MAX_TOOL_LOOPS) {
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
          let assistantTextThisTurn = ''
          let stopReason = ''
          let messageCompleteSeen = false

          for await (const ev of events) {
            if (closed || request.signal.aborted) {
              upstreamAbort.abort()
              break
            }
            switch (ev.type) {
              case 'text_delta':
                assistantTextThisTurn += ev.text
                send('token', { content: ev.text })
                break
              case 'tool_use_start':
                send('tool_use_start', { tool_use_id: ev.toolUseId, tool_name: ev.toolName })
                break
              case 'tool_use_delta':
                send('tool_use_delta', {
                  tool_use_id: ev.toolUseId,
                  partial_json: ev.partialJson,
                })
                break
              case 'tool_use_complete':
                turnToolUses.push({ id: ev.toolUseId, name: ev.toolName, input: ev.input })
                send('tool_use_complete', {
                  tool_use_id: ev.toolUseId,
                  tool_name: ev.toolName,
                  input: ev.input,
                })
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
                send('error', { code: ev.code, message: ev.message, retryable: ev.retryable })
                throw new Error(`provider error: ${ev.code} ${ev.message}`)
            }
          }

          accumulatedText.push(assistantTextThisTurn)
          accumulatedToolUses.push(...turnToolUses)

          // B6 fix — if message_complete never arrived this turn, treat as
          // upstream failure rather than silently marking 'done'.
          if (!messageCompleteSeen && !closed && !request.signal.aborted) {
            throw new Error('upstream stream ended without message_complete')
          }

          // No tool_use → done
          if (turnToolUses.length === 0 || stopReason !== 'tool_use') {
            finishReason = stopReason || 'end_turn'
            break
          }

          // Append assistant blocks + tool results, loop
          const assistantBlocks: LlmMessage['content'] = []
          if (assistantTextThisTurn) {
            assistantBlocks.push({ type: 'text', text: assistantTextThisTurn })
          }
          for (const tu of turnToolUses) {
            assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
          }
          workingMessages = [...workingMessages, { role: 'assistant', content: assistantBlocks }]

          const toolResults: LlmMessage['content'] = []
          for (const tu of turnToolUses) {
            const def = getToolByName(tu.name)
            let resultText = ''
            let ok = true
            let summary = ''
            if (!def) {
              resultText = JSON.stringify({ error: `Unknown tool: ${tu.name}` })
              ok = false
              summary = 'unknown tool'
            } else if (def.dispatch.kind === 'composio') {
              const r = await executeIntegrationAction(def.dispatch.action, tu.input, { clientId })
              ok = r.ok
              if (r.ok) {
                resultText = JSON.stringify(r.data).slice(0, 16_000)
                summary = `${tu.name} ok`
              } else {
                resultText = JSON.stringify({ error: r.message, code: r.code })
                summary = `${tu.name} failed: ${r.code}`
              }
            } else {
              const r = await dispatchInternalTool(def.dispatch.fn, tu.input, {
                clientId,
                userId,
              })
              ok = r.ok
              resultText = JSON.stringify(r.data).slice(0, 16_000)
              summary = ok ? `${tu.name} ok` : `${tu.name} failed`
            }
            send('tool_result', { tool_use_id: tu.id, ok, summary })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText })
          }

          workingMessages = [...workingMessages, { role: 'user', content: toolResults }]
          toolLoops += 1
        }

        // Persist final assistant message
        const finalText = accumulatedText.join('').trim()
        // B5 — empty content + no tool uses is unexpected; mark as error so
        // mobile UI can branch (don't render an empty bubble).
        const persistContent =
          finalText ||
          (accumulatedToolUses.length > 0
            ? '[Action taken — see tool results.]'
            : '')
        const persistStatus = persistContent ? 'done' : 'error'

        await sb
          .from('agent_chat_messages')
          .update({
            content: persistContent,
            status: persistStatus,
            tool_uses: accumulatedToolUses,
            finish_reason: finishReason,
            usage: { ...totalUsage, model: modelId, budget_tier: initialTier },
          })
          .eq('id', assistantMessageId)

        // B2 — record spend regardless of error/success path. Computed here
        // for the success path; finally{} block records it on error too.
        await chargeAndMaybeSurface(send, clientId, plan, modelId, totalUsage, initialTier)

        send('message_complete', {
          message_id: assistantMessageId,
          finish_reason: finishReason,
          usage: { ...totalUsage, model: modelId },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        send('error', { code: 'chat.upstream_error', message, retryable: true })
        // B5 — mark message as error not done
        await sb
          .from('agent_chat_messages')
          .update({
            status: 'error',
            content: accumulatedText.join('') || `[Stream failed: ${message}]`,
            finish_reason: 'error',
            usage: { ...totalUsage, model: modelId, budget_tier: initialTier },
          })
          .eq('id', assistantMessageId)
        // B2 — STILL bill the customer for tokens consumed before the error
        await chargeAndMaybeSurface(send, clientId, plan, modelId, totalUsage, initialTier)
      } finally {
        finalize(controller)
      }
    },
    cancel() {
      // Client disconnected
      upstreamAbort.abort()
      finalize(null)
    },
  })

  // Wire request abort to upstream abort + cleanup
  request.signal.addEventListener('abort', () => {
    upstreamAbort.abort()
    finalize(null)
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Request-Id': requestId,
      Connection: 'keep-alive',
    },
  })

  // ----- helpers -----

  function finalize(controller: ReadableStreamDefaultController | null) {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    if (controller) {
      try {
        controller.close()
      } catch {
        /* already closed */
      }
    }
  }
}

async function chargeAndMaybeSurface(
  send: (event: string, data: unknown) => void,
  clientId: string,
  plan: string | null,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
  initialTier: BudgetTier
) {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return
  const costPence = computeCostPence(modelId, usage)
  if (costPence <= 0) return
  const result = await recordLlmSpend(clientId, costPence, plan)
  if (result.tier !== 'normal' && result.tier !== initialTier) {
    send('budget_changed', {
      tier: result.tier,
      spent_pence: result.spentPence,
      cap_pence: result.capPence,
    })
  }
}

interface DbChatMessage {
  id: string
  role: 'user' | 'assistant' | string
  content: string | null
  status: string
}

function toLlmMessage(m: DbChatMessage): LlmMessage {
  const text = m.content ?? ''
  return {
    role: m.role === 'user' ? 'user' : 'assistant',
    content: [{ type: 'text', text }],
  }
}
