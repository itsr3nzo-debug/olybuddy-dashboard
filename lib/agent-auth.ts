/**
 * Agent-API-key auth helper for VPS → dashboard calls.
 *
 * Every VPS agent has an `agent_api_key` (oak_...) stored in Supabase's
 * `agent_config.agent_api_key`. They send it as `Authorization: Bearer oak_...`
 * on calls to /api/agent/*.
 *
 * We look it up, confirm it matches exactly one client, and return the client_id
 * so the downstream handler can scope its reads/writes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/** SHA-256 hex of an agent API key. Used for at-rest hash lookup so a DB
 *  leak doesn't yield a working credential. */
export function hashAgentKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

export interface AgentContext {
  clientId: string
  businessName: string | null
  agentName: string | null
  trustLevel: number
}

/**
 * Authenticate a VPS-agent request. Returns the AgentContext on success,
 * or a NextResponse (401/403) that the handler should return directly.
 */
export async function authenticateAgent(req: NextRequest): Promise<AgentContext | NextResponse> {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(oak_[A-Za-z0-9_-]+)$/)
  if (!match) {
    return NextResponse.json(
      { error: 'Missing or malformed Authorization header. Expected "Bearer oak_…"' },
      { status: 401 },
    )
  }

  const apiKey = match[1]
  const apiKeyHash = hashAgentKey(apiKey)
  const supabase = svc()
  // Primary lookup: SHA-256 hash. This is the post-migration hot path.
  let { data, error } = await supabase
    .from('agent_config')
    .select('client_id, business_name, agent_name, trust_level')
    .eq('agent_api_key_hash', apiKeyHash)
    .maybeSingle()

  // Devil's-advocate fix P1 #4: previous_api_key_hash with TTL window.
  // During key rotation the worker takes ~30-60s to push the new key to
  // the VPS .env. During that window the VPS still calls with the OLD
  // key. We accept it via previous_api_key_hash (with previous_api_key_
  // expires_at not yet past) so there's no service interruption.
  if (!data && !error) {
    const prev = await supabase
      .from('agent_config')
      .select('client_id, business_name, agent_name, trust_level, previous_api_key_expires_at')
      .eq('previous_api_key_hash', apiKeyHash)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = prev.data as any
    if (row && row.previous_api_key_expires_at && new Date(row.previous_api_key_expires_at).getTime() > Date.now()) {
      data = row
    }
    if (prev.error) error = prev.error
  }

  // Fallback: legacy plaintext column. If a VPS is calling with a key that
  // was rotated before backfill ran, fall back to the old column once and
  // self-heal the hash on success. Remove this fallback once the legacy
  // column is dropped (tracked in #5 secret-rotation runbook).
  if (!data && !error) {
    const legacy = await supabase
      .from('agent_config')
      .select('client_id, business_name, agent_name, trust_level')
      .eq('agent_api_key', apiKey)
      .maybeSingle()
    if (legacy.data) {
      data = legacy.data
      // Round-3 fix #9: telemetry on legacy fallback hits. Without this
      // we couldn't tell whether the legacy column is still in active
      // use — and the runbook's "drop after 7 clean days" verification
      // step had no data to look at. Now: write to integration_signals
      // every time a legacy lookup succeeds, so SLO dashboard can show
      // the trend going to zero before we drop the column.
      void supabase.from('integration_signals').insert({
        source: 'agent-auth',
        kind: 'legacy_key_fallback_hit',
        external_id: legacy.data.client_id,
        raw: { client_id: legacy.data.client_id, agent: legacy.data.agent_name },
        occurred_at: new Date().toISOString(),
      }).then(() => {}, () => {})
      // Backfill the hash for next time. Fire-and-forget.
      void supabase
        .from('agent_config')
        .update({ agent_api_key_hash: apiKeyHash })
        .eq('client_id', legacy.data.client_id)
        .then(() => {}, () => {})
    }
    if (legacy.error) error = legacy.error
  }

  if (error) {
    return NextResponse.json({ error: `Auth lookup failed: ${error.message}` }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Unknown agent API key' }, { status: 403 })
  }

  // Audit: every agent call gets logged via a cheap upsert to agent_config.last_api_call_at.
  // Fire-and-forget — don't block on this.
  void supabase
    .from('agent_config')
    .update({ last_call_at: new Date().toISOString() })
    .eq('client_id', data.client_id)
    .then(() => {}, () => {})

  return {
    clientId: data.client_id,
    businessName: data.business_name,
    agentName: data.agent_name,
    trustLevel: data.trust_level,
  }
}

/**
 * Convenience: log a meaningful action the agent performed via a proxy endpoint.
 * Drops into `agent_actions` table which feeds the weekly ROI report + dashboard widget.
 */
export async function logAgentAction(args: {
  clientId: string
  category: string // must match agent_actions_category_check enum
  skillUsed: string
  summary: string
  outcomeTag?: 'replied' | 'no_reply' | 'booked' | 'converted' | 'negative' | 'unsubscribed' | 'n_a'
  valueGbp?: number
  minutesSaved?: number
  contactPhone?: string
  contactName?: string
  meta?: Record<string, unknown>
}): Promise<void> {
  const supabase = svc()
  await supabase.from('agent_actions').insert({
    client_id: args.clientId,
    occurred_at: new Date().toISOString(),
    category: args.category,
    skill_used: args.skillUsed,
    summary: args.summary,
    outcome_tag: args.outcomeTag ?? 'n_a',
    value_gbp: args.valueGbp,
    minutes_saved: args.minutesSaved ?? 0,
    contact_phone: args.contactPhone,
    contact_name: args.contactName,
    meta: args.meta ?? {},
  }).then(() => {}, e => console.error('[logAgentAction]', e))
}
