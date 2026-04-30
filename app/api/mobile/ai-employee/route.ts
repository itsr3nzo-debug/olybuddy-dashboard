/**
 * GET   /api/mobile/ai-employee  — current AI Employee config
 * PATCH /api/mobile/ai-employee  — partial update (name, tone, hours, instructions)
 *
 * Schema mapping (agent_config table, verified live 2026-04-29):
 *   agent_name           ← exposed as `agent_name`
 *   tone                 ← exposed as `agent_tone` (PATCH input)
 *   hours (jsonb)        ← exposed as `working_hours` (PATCH input)
 *   personality_prompt   ← exposed as `instructions` (PATCH input)
 *   paused, paused_until ← passthrough
 *   enabled_tools (text[]) ← passthrough
 *
 * Note: any change here writes to `agent_config`. The VPS picks up the new
 * personality.json on next restart via the existing apply-sender-roles
 * worker pattern.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

interface PatchBody {
  agent_name?: string
  agent_tone?: string
  working_hours?: string | Record<string, unknown>
  instructions?: string
  paused?: boolean
  paused_until?: string | null
}

// Map mobile-API keys → DB column names
const KEY_MAP: Record<keyof PatchBody, string> = {
  agent_name: 'agent_name',
  agent_tone: 'tone',
  working_hours: 'hours',
  instructions: 'personality_prompt',
  paused: 'paused',
  paused_until: 'paused_until',
}

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const sb = createUntypedServiceClient()
    const { data, error } = await sb
      .from('agent_config')
      .select(
        'agent_name, tone, hours, personality_prompt, paused, paused_until, enabled_tools'
      )
      .eq('client_id', clientId)
      .maybeSingle()
    if (error) throw Errors.internal(error.message)

    return jsonResponse(
      {
        agent_name: data?.agent_name ?? null,
        agent_tone: data?.tone ?? null,
        working_hours: data?.hours ?? null,
        instructions: data?.personality_prompt ?? null,
        paused: !!data?.paused,
        paused_until: data?.paused_until ?? null,
        enabled_tools: data?.enabled_tools ?? [],
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

export async function PATCH(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const body = (await request.json().catch(() => null)) as PatchBody | null
    if (!body) throw Errors.validation({ message: 'JSON body required' })

    // Validate before mapping
    if (typeof body.agent_name === 'string') {
      const name = body.agent_name.trim()
      if (name.length === 0 || name.length > 30) {
        throw Errors.validation({ field: 'agent_name', length: '1-30' })
      }
      body.agent_name = name
    }
    if (typeof body.instructions === 'string' && body.instructions.length > 4000) {
      throw Errors.validation({ field: 'instructions', max_chars: 4000 })
    }

    // Map API keys → DB columns
    const updates: Record<string, unknown> = {}
    for (const key of Object.keys(KEY_MAP) as Array<keyof PatchBody>) {
      if (key in body) updates[KEY_MAP[key]] = body[key]
    }
    if (Object.keys(updates).length === 0) {
      throw Errors.validation({ message: 'No valid fields' })
    }
    updates.updated_at = new Date().toISOString()

    const sb = createUntypedServiceClient()
    const { data, error } = await sb
      .from('agent_config')
      .update(updates)
      .eq('client_id', clientId)
      .select(
        'agent_name, tone, hours, personality_prompt, paused, paused_until, enabled_tools'
      )
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!data) throw Errors.notFound('agent_config row missing for this client.')

    return jsonResponse(
      {
        agent_name: data.agent_name,
        agent_tone: data.tone,
        working_hours: data.hours,
        instructions: data.personality_prompt,
        paused: !!data.paused,
        paused_until: data.paused_until,
        enabled_tools: data.enabled_tools ?? [],
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
