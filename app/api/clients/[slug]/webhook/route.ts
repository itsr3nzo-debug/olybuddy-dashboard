/**
 * POST /api/clients/[slug]/webhook
 *
 * External webhook receiver — the "real unlock" for Typeform / Calendly /
 * website-form / Fathom-transcript → AI Employee automation.
 *
 * Auth: bearer whk_... token in Authorization header. Per-client token
 * stored in agent_config.webhook_token. Rotate via dashboard.
 *
 * Body: { trigger_type, source?, payload? }
 * - trigger_type: one of new_lead | booking | call_transcript | message_received | payment_received | custom
 * - source: free string (helps debugging — "typeform", "calendly", "contact_form")
 * - payload: arbitrary JSON from the external service
 *
 * On success: writes to external_triggers. Agent's external-trigger-handler
 * skill polls this table every 5 min and dispatches to the right skill.
 *
 * Non-goals:
 * - This endpoint does NOT call Anthropic (agent uses its own Max sub).
 * - This endpoint does NOT reply to the external source synchronously —
 *   it returns 202 Accepted and the agent does the work async.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const VALID_TRIGGER_TYPES = new Set([
  'new_lead',
  'booking',
  'call_transcript',
  'message_received',
  'payment_received',
  'custom',
])

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  // 1. Auth — resolve client_id by slug + webhook_token
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(whk_[a-f0-9]+)$/i)
  if (!m) {
    return NextResponse.json({
      error: 'Missing or malformed webhook token. Expected: Authorization: Bearer whk_...',
    }, { status: 401 })
  }
  const token = m[1]

  const supabase = service()
  const { data: cfg } = await supabase
    .from('agent_config')
    .select('client_id, clients!inner(slug)')
    .eq('webhook_token', token)
    .maybeSingle()

  const resolvedClientId = (cfg as { client_id?: string } | null)?.client_id
  const resolvedSlug = ((cfg as unknown as { clients?: { slug?: string } } | null)?.clients)?.slug

  if (!resolvedClientId || resolvedSlug !== slug) {
    // Constant-time-ish: same error whether token is bad or slug is wrong
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // 2. Parse + validate body
  let body: {
    trigger_type?: string
    source?: string
    payload?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.trigger_type || !VALID_TRIGGER_TYPES.has(body.trigger_type)) {
    return NextResponse.json({
      error: `trigger_type required, one of: ${[...VALID_TRIGGER_TYPES].join(', ')}`,
    }, { status: 400 })
  }

  // Payload size cap — webhooks shouldn't carry huge blobs
  const payloadStr = JSON.stringify(body.payload ?? {})
  if (payloadStr.length > 100_000) {
    return NextResponse.json({ error: 'Payload too large (>100KB)' }, { status: 413 })
  }

  // 3. Capture useful headers (but strip auth)
  const headersEntries: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'authorization') return
    if (k.toLowerCase() === 'cookie') return
    headersEntries[k] = v
  })

  // 4. Insert into external_triggers
  const { data, error } = await supabase.from('external_triggers').insert({
    client_id: resolvedClientId,
    trigger_type: body.trigger_type,
    source: body.source ?? null,
    payload: body.payload ?? {},
    headers: headersEntries,
  }).select('id, received_at, status').single()

  if (error) {
    console.error('[webhook] insert failed:', error)
    return NextResponse.json({ error: 'Failed to queue trigger' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    id: data.id,
    received_at: data.received_at,
    status: data.status,
    note: 'Your AI Employee will process this on its next poll (typically within 5 minutes).',
  }, { status: 202 })
}
