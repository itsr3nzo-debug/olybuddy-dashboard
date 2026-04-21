/**
 * POST /api/webhooks/composio
 *
 * Unified Composio webhook receiver. Replaces the per-provider webhook paths
 * (/api/webhooks/stripe, /gmail, /calendar). Composio handles provider-side
 * registration + normalisation for all 118 toolkits — we just receive.
 *
 * Headers (Composio / standardwebhooks):
 *   webhook-id         — unique event id (Svix-style)
 *   webhook-timestamp  — unix seconds
 *   webhook-signature  — "v1,<base64>" where <base64> = HMAC-SHA256(id.ts.body, secret)
 *
 * Env:
 *   COMPOSIO_WEBHOOK_SECRET  — shared project-level secret from Composio dashboard
 *
 * Payload versions: V1 / V2 / V3 are all supported via @composio/core's
 * verifyWebhook() parser. We target V3 primarily (normalised IncomingTriggerPayload).
 *
 * What we do with a verified event:
 *   1. Resolve tenant: payload.metadata.connectedAccount.id → integrations row → client_id
 *   2. Map to integration_signals (same table the VPS poller writes)
 *   3. Emit one signal_id (hash of event id) so re-deliveries are idempotent
 *
 * Replay/dedup: webhook-id is the event's stable identifier. We key `signal_id`
 * off it so Composio retries land as no-ops via the (client_id, signal_id) unique
 * index.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Composio } from '@composio/core'
import crypto from 'node:crypto'

// Single instance shared across requests — just used for verifyWebhook (pure fn)
let _composio: Composio | null = null
function composio(): Composio {
  if (!_composio) {
    _composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? 'not-needed-for-verify' })
  }
  return _composio
}

function svc(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function logDlq(sb: SupabaseClient, reason: string, body: string, meta: Record<string, unknown> = {}) {
  try {
    await sb.from('webhook_dlq').insert({
      provider: 'composio',
      reason,
      body: JSON.stringify({ raw: body.slice(0, 3500), meta }).slice(0, 4000),
    })
  } catch {
    // DLQ failure — not much we can do.
  }
}

/** Map a verified payload's trigger slug → our internal signal_type vocabulary.
 * Keep this small — the VPS agent's classifier handles fine-grained cases.
 * We aim at COMMON high-value events the owner actually cares about. */
function deriveSignalType(triggerSlug: string, toolkitSlug: string): { signal_type: string; urgency: 'emergency' | 'urgent' | 'normal' | 'low' } {
  const t = triggerSlug.toUpperCase()
  // Money — success: INVOICE_PAYMENT_SUCCEEDED, CHARGE_SUCCEEDED (some schemes), CHECKOUT_SESSION_COMPLETED
  if (t.includes('PAYMENT_SUCCEEDED') || t.includes('CHARGE_SUCCEEDED') || t.includes('CHECKOUT_SESSION_COMPLETED') || t.includes('INVOICE_PAID')) {
    return { signal_type: 'payment_received', urgency: 'normal' }
  }
  // Money — problems: PAYMENT_FAILED, CHARGE_FAILED, DISPUTE
  if (t.includes('PAYMENT_FAILED') || t.includes('CHARGE_FAILED') || t.includes('DISPUTE')) {
    return { signal_type: 'payment_problem', urgency: 'urgent' }
  }
  if (t.includes('INVOICE') && (t.includes('OVERDUE') || t.includes('FINALIZED'))) {
    return { signal_type: 'invoice_event', urgency: 'normal' }
  }
  // Subscription / product events — low priority unless user-visible
  if (t.includes('SUBSCRIPTION_DELETED') || t.includes('CUSTOMER_DELETED')) {
    return { signal_type: 'subscription_change', urgency: 'urgent' }
  }
  if (t.includes('SUBSCRIPTION_ADDED') || t.includes('SUBSCRIPTION_UPDATED')) {
    return { signal_type: 'subscription_change', urgency: 'normal' }
  }
  // Comms — Gmail triggers are `GMAIL_NEW_GMAIL_MESSAGE` (no suffix), Outlook is `OUTLOOK_MESSAGE_TRIGGER`
  if (t.includes('GMAIL_MESSAGE') || t.includes('OUTLOOK_MESSAGE') || t.includes('EMAIL_RECEIVED')) {
    return { signal_type: 'new_email', urgency: 'normal' }
  }
  // Slack messages — `SLACK_RECEIVE_MESSAGE` / `SLACK_RECEIVE_BOT_MESSAGE`
  if (t.includes('RECEIVE_MESSAGE') || t.includes('CHANNEL_MESSAGE')) {
    return { signal_type: 'new_message', urgency: 'normal' }
  }
  // Calendar — `GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER` etc.
  if (t.includes('CALENDAR') && t.includes('EVENT')) {
    return { signal_type: 'calendar_change', urgency: 'normal' }
  }
  // CRM contact/deal events — HUBSPOT_CONTACT_CREATED_TRIGGER, HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER
  if (t.includes('CONTACT_CREATED')) {
    return { signal_type: 'new_contact', urgency: 'normal' }
  }
  if (t.includes('DEAL_STAGE_UPDATED')) {
    return { signal_type: 'deal_update', urgency: 'normal' }
  }
  return { signal_type: 'integration_event', urgency: 'low' }
}

/** Stable signal_id from Composio's webhook-id. Hashing keeps the DB column short
 * + predictable while preserving idempotency on retry. */
function signalIdFrom(webhookId: string): string {
  return 'cx_' + crypto.createHash('sha256').update(webhookId).digest('hex').slice(0, 40)
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const sb = svc()

  const webhookId = req.headers.get('webhook-id') ?? ''
  const webhookTimestamp = req.headers.get('webhook-timestamp') ?? ''
  const webhookSignature = req.headers.get('webhook-signature') ?? ''
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET

  if (!secret) {
    await logDlq(sb, 'no_secret_configured', rawBody, { webhookId })
    return NextResponse.json({ error: 'COMPOSIO_WEBHOOK_SECRET not configured' }, { status: 501 })
  }
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return NextResponse.json({ error: 'missing webhook headers' }, { status: 400 })
  }

  // Verify via the official SDK — does HMAC + timestamp tolerance + payload parse
  let verified
  try {
    verified = await composio().triggers.verifyWebhook({
      payload: rawBody,
      signature: webhookSignature,
      id: webhookId,
      timestamp: webhookTimestamp,
      secret,
    })
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'verify_failed'
    await logDlq(sb, `verify_failed:${reason.slice(0, 80)}`, rawBody, { webhookId })
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 })
  }

  const p = verified.payload
  // p = IncomingTriggerPayload { id, triggerSlug, toolkitSlug, userId, payload, metadata.connectedAccount.{id,uuid} }

  // Resolve tenant by connected-account id — stored on the integrations row when OAuth flow created it
  const connectedAccountId = p.metadata?.connectedAccount?.id ?? p.metadata?.connectedAccount?.uuid ?? ''
  if (!connectedAccountId) {
    await logDlq(sb, 'no_connected_account_id', rawBody, { webhookId, trigger: p.triggerSlug })
    return NextResponse.json({ ok: true, note: 'no tenant, logged to dlq' })
  }

  // connected-account-id lives in integrations.metadata JSONB (set by the OAuth callback)
  const { data: integration } = await sb
    .from('integrations')
    .select('client_id, provider')
    .eq('status', 'connected')
    .filter('metadata->>composio_connected_account_id', 'eq', connectedAccountId)
    .maybeSingle()

  if (!integration) {
    await logDlq(sb, 'tenant_not_resolved', rawBody, { webhookId, connectedAccountId, trigger: p.triggerSlug })
    return NextResponse.json({ ok: true, note: 'tenant not resolved, logged to dlq' })
  }

  const { signal_type, urgency } = deriveSignalType(p.triggerSlug, p.toolkitSlug)

  // One-line human-readable summary. Keep payload-derived text short + treat as untrusted display data.
  const rawDisplay = JSON.stringify(p.payload ?? {}).slice(0, 400)

  const signalId = signalIdFrom(webhookId)

  const { error } = await sb
    .from('integration_signals')
    .upsert(
      {
        client_id: integration.client_id,
        signal_id: signalId,
        provider: (integration.provider || p.toolkitSlug.toLowerCase()),
        signal_type,
        source_ref: `composio:${p.triggerSlug}:${p.id}`,
        summary: `${p.triggerSlug} fired`,
        urgency,
        confidence: 1.0,
        proposed_action: {
          type: `${signal_type}_handler`,
          params: { trigger_slug: p.triggerSlug, toolkit: p.toolkitSlug, event_id: p.id },
          trust_class: 'info_reply',
        },
        extracted_context: rawDisplay,
        customer_phone: null,
        status: 'new',
      },
      { onConflict: 'client_id,signal_id', ignoreDuplicates: true },
    )

  if (error) {
    await logDlq(sb, `db_insert_failed:${error.message.slice(0, 80)}`, rawBody, { webhookId, signalId })
    // Still 200 — Composio will retry forever otherwise
    return NextResponse.json({ ok: true, note: 'dlq' })
  }

  return NextResponse.json({ ok: true, signal_id: signalId })
}

/** GET — liveness + config probe */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/webhooks/composio',
    configured: Boolean(process.env.COMPOSIO_WEBHOOK_SECRET),
  })
}
