import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchAgentAlert } from '@/lib/agent-alerts'
import { verifyHmacSha256Hex } from '@/lib/webhooks/verify-signature'

/**
 * POST /api/webhook/instantly
 *
 * Replaces the Smartlead webhook handler (#16). Instantly fires events
 * on email send/open/reply/bounce/unsubscribe. We care about:
 *
 *   - email.replied   -> P1 alert to Senku, log inbound to comms_log
 *   - email.bounced   -> mark lead dead in integration_signals (so L can clean)
 *   - email.unsubscribed -> hard remove from any active campaigns (best-effort)
 *
 * Auth: HMAC-SHA256 signature in `X-Instantly-Signature` header, computed
 * over the raw body using INSTANTLY_WEBHOOK_SECRET. Constant-time compare.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET
// Devil's-advocate fix P0 #16: Instantly's exact signing scheme isn't
// verified against live payloads yet. Until Renzo confirms the header
// name + HMAC payload composition (raw body? timestamp+body?) and sets
// INSTANTLY_WEBHOOK_VERIFIED=true, we LOG events but don't act on them.
// This stops a forged or replayed event from triggering Squad alerts
// during the cutover window.
const VERIFIED = process.env.INSTANTLY_WEBHOOK_VERIFIED === 'true'

function verify(rawBody: string, signature: string | null): boolean {
  return verifyHmacSha256Hex(rawBody, signature, WEBHOOK_SECRET)
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-instantly-signature') || req.headers.get('x-instantly-webhook-signature')

  // Two gates:
  //   1. WEBHOOK_SECRET set + VERIFIED=true -> normal HMAC enforcement.
  //   2. WEBHOOK_SECRET set but VERIFIED=false -> verify softly: if the sig
  //      checks out, accept; if not, log + drop (don't 401 yet — Renzo
  //      could still be testing the scheme).
  //   3. No secret at all -> log AND DROP unconditionally. We previously
  //      "accepted unverified" which was a forgery-friendly default.
  let trusted = false
  if (WEBHOOK_SECRET) {
    if (verify(raw, sig)) {
      trusted = true
    } else if (VERIFIED) {
      // Strict mode: bad signature = reject.
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    } else {
      console.warn('[instantly-webhook] signature verification failed (cutover mode) \u2014 logging only')
    }
  } else {
    console.warn('[instantly-webhook] INSTANTLY_WEBHOOK_SECRET not set \u2014 dropping event')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const eventType = body.event_type || body.type || body.event || 'unknown'
  const lead = body.lead || body.data?.lead || body
  const email = (lead?.email || '').toLowerCase()
  const campaignName = body.campaign?.name || body.data?.campaign?.name || null

  // Universal log entry for every event we receive — handy for debugging.
  try {
    await supabase.from('integration_signals').insert({
      source: 'instantly',
      kind: eventType,
      external_id: body.id || lead?.id || null,
      raw: body,
      occurred_at: new Date().toISOString(),
    })
  } catch { /* non-fatal */ }

  // Only act on events when the signature is verified. Untrusted events
  // are still logged to integration_signals (above) for debugging the
  // signing scheme, but they don't trigger comms_log writes or Senku
  // alerts. Without this gate an attacker could forge replies to make
  // Senku waste a cycle chasing fake leads.
  if (!trusted) {
    return NextResponse.json({ ok: true, accepted: false, note: 'logged for review' })
  }

  if (eventType.includes('reply') || eventType === 'email.replied') {
    // Log to comms_log + alert Senku.
    try {
      await supabase.from('comms_log').insert({
        channel: 'email',
        direction: 'inbound',
        from_addr: email,
        subject: body.subject || lead?.subject || null,
        body: body.reply_text || body.body || null,
        meta: { source: 'instantly', campaign: campaignName, lead },
      })
    } catch (e) { console.warn('[instantly-webhook] comms_log insert failed:', e) }

    await dispatchAgentAlert({
      target: 'senku',
      priority: 'P1',
      category: 'cold_email_reply',
      subject: `Reply from ${email} on Instantly campaign`,
      body: [
        `New reply on cold-email campaign \u2014 worth a same-day human follow-up.`,
        ``,
        `**From:** ${email}`,
        `**Campaign:** ${campaignName || 'unknown'}`,
        ``,
        `Reply text:`,
        '```',
        body.reply_text || body.body || '(no body in webhook payload)',
        '```',
      ].join('\n'),
      source: 'webhook:instantly',
      meta: { lead, campaign: campaignName },
    })
  } else if (eventType.includes('bounce')) {
    // Best-effort: signal L to mark the lead dead in the Sheet on next pass.
    try {
      await supabase.from('integration_signals').insert({
        source: 'instantly',
        kind: 'lead_bounced',
        external_id: email,
        raw: { email, campaign: campaignName },
        occurred_at: new Date().toISOString(),
      })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true })
}
