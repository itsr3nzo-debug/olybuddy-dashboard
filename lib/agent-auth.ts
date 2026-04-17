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

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
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
  const supabase = svc()
  const { data, error } = await supabase
    .from('agent_config')
    .select('client_id, business_name, agent_name, trust_level')
    .eq('agent_api_key', apiKey)
    .maybeSingle()

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
