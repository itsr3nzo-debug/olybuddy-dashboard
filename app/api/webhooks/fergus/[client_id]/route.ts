import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

/**
 * POST /api/webhooks/fergus/<client_id>
 *
 * Receives Zapier-dispatched Fergus events. Fergus has no native outbound
 * webhooks in the Partner API — Zapier is the only event source today.
 *
 * How Julian wires this:
 *   Zapier → trigger: Fergus "New Job" (or Job Completion / New Customer / etc.)
 *   Zapier → action: Webhooks by Zapier — POST
 *     URL:  https://nexley.vercel.app/api/webhooks/fergus/<his_client_uuid>
 *     Header: X-Nexley-Webhook-Token: <per-client secret from integrations.metadata.webhook_token>
 *     Body:   {event: 'job.created'|'job.completed'|'customer.created'|..., payload: {...}}
 *
 * Event types we normalise into integration_signals:
 *   job.created        → signal_type='fergus_job_created'
 *   job.completed      → signal_type='fergus_job_completed'   (fires when all phases invoiced)
 *   customer.created   → signal_type='fergus_customer_created'
 *   site.created       → signal_type='fergus_site_created'
 *   quote.created      → signal_type='fergus_quote_created'
 *   quote.modified     → signal_type='fergus_quote_modified'
 *
 * Dedup: the Zapier run id (header `X-Zap-Run-Id`) or a hash of (event+payload)
 * is used as signal_id so retries are idempotent.
 *
 * The VPS agent picks these up via its existing integration_signals polling
 * loop — same pipeline Composio events flow through.
 */

// Use service role to write signals regardless of RLS
function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

function urgencyFor(eventType: string): 'low' | 'normal' | 'high' {
  if (eventType === 'job.completed') return 'high'
  if (eventType === 'job.created' || eventType === 'quote.modified') return 'normal'
  return 'low'
}

function summaryFor(eventType: string, payload: Record<string, unknown>): string {
  const p = payload as { jobNo?: string; title?: string; customerFullName?: string; name?: string }
  switch (eventType) {
    case 'job.created':
      return `New Fergus job${p.jobNo ? ` ${p.jobNo}` : ''}${p.title ? ` — ${p.title}` : ''}`
    case 'job.completed':
      return `Fergus job completed${p.jobNo ? ` ${p.jobNo}` : ''}${p.title ? ` — ${p.title}` : ''} (all phases invoiced)`
    case 'customer.created':
      return `New Fergus customer${p.customerFullName ? ` — ${p.customerFullName}` : ''}`
    case 'site.created':
      return `New Fergus site${p.name ? ` — ${p.name}` : ''}`
    case 'quote.created':
      return `New Fergus quote${p.title ? ` — ${p.title}` : ''}`
    case 'quote.modified':
      return `Fergus quote modified${p.title ? ` — ${p.title}` : ''}`
    default:
      return `Fergus ${eventType}`
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params

  // Basic shape validation on client_id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 })
  }

  // Verify shared-secret header against the token stored on the client's Fergus integration
  const presented = req.headers.get('x-nexley-webhook-token') ?? ''
  if (!presented) {
    return NextResponse.json({ error: 'missing X-Nexley-Webhook-Token' }, { status: 401 })
  }

  const sb = supa()
  const { data: integ, error: integErr } = await sb
    .from('integrations')
    .select('metadata')
    .eq('client_id', client_id)
    .eq('provider', 'fergus')
    .eq('status', 'connected')
    .maybeSingle()

  if (integErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!integ) {
    return NextResponse.json({ error: 'no connected fergus integration for this client' }, { status: 404 })
  }

  const expected = (integ.metadata as { webhook_token?: string } | null)?.webhook_token
  if (!expected) {
    return NextResponse.json({
      error: 'webhook_not_configured',
      reason: 'Client has no Fergus webhook_token set. Generate one in dashboard → integrations → Fergus → "Show webhook URL".',
    }, { status: 409 })
  }

  // Constant-time compare
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'bad_token' }, { status: 401 })
  }

  // Parse body
  const body = await req.json().catch(() => null) as { event?: string; payload?: Record<string, unknown> } | null
  if (!body || typeof body.event !== 'string') {
    return NextResponse.json({ error: 'invalid body — expected {event, payload}' }, { status: 400 })
  }
  const event = body.event.toLowerCase()
  const payload = body.payload ?? {}

  const allowedEvents = new Set([
    'job.created', 'job.completed', 'customer.created', 'site.created',
    'quote.created', 'quote.modified',
  ])
  if (!allowedEvents.has(event)) {
    return NextResponse.json({
      error: 'unsupported_event',
      event,
      allowed: [...allowedEvents],
    }, { status: 400 })
  }

  // Dedup key: prefer Zapier run id, else hash the body
  const zapRunId = req.headers.get('x-zap-run-id') ?? ''
  const signalBase = zapRunId || `${event}:${JSON.stringify(payload)}`
  const signalId = crypto.createHash('sha256').update(signalBase).digest('hex').slice(0, 32)

  const signalType = `fergus_${event.replace('.', '_')}`
  const sourceRef = (payload as { jobNo?: string; id?: number | string }).jobNo
    ?? String((payload as { id?: number | string }).id ?? '')
    ?? ''

  const { error: insErr } = await sb.from('integration_signals').upsert({
    client_id,
    signal_id: signalId,
    provider: 'fergus',
    signal_type: signalType,
    detected_at_iso: new Date().toISOString(),
    source_ref: sourceRef || null,
    summary: summaryFor(event, payload),
    urgency: urgencyFor(event),
    confidence: 1.0,
    status: 'pending',
    extracted_context: payload,
  }, { onConflict: 'client_id,signal_id', ignoreDuplicates: true })

  if (insErr) {
    return NextResponse.json({ error: 'insert_failed', detail: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, signal_id: signalId, signal_type: signalType })
}

// Allow HEAD for Zapier's webhook test ping
export async function HEAD() {
  return new NextResponse(null, { status: 200 })
}
