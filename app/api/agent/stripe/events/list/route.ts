/**
 * GET /api/agent/stripe/events/list?since=<iso>
 *
 * Aggregates Stripe activity across 5 resources to simulate an events list,
 * because Composio does not ship a single `STRIPE_LIST_EVENTS` tool. Verified
 * 2026-04-18 — only resource-specific list actions exist:
 *   STRIPE_LIST_CHARGES, STRIPE_LIST_REFUNDS, STRIPE_LIST_INVOICES,
 *   STRIPE_LIST_SUBSCRIPTIONS, STRIPE_LIST_PAYMENT_INTENTS
 *
 * We fetch all 5 in parallel, filter to items created since `since`, and emit a
 * normalised Stripe-event-shaped payload for the scanner:
 *   { type: 'charge.failed' | 'charge.refunded' | ..., data: { object: {...} } }
 *
 * This lets /scan-stripe-events work unchanged — it classifies on `type`.
 *
 * If Stripe is not connected for this client, returns 409 with events: [].
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'

interface StripeObject {
  id?: string
  created?: number
  status?: string
  amount?: number
  amount_refunded?: number
  [k: string]: unknown
}

interface ComposioListResponse {
  successful?: boolean
  data?: { data?: StripeObject[] }
  error?: string
}

interface SimEvent {
  id: string
  type: string
  created: number
  data: { object: StripeObject }
}

async function callComposio(
  action: string,
  entityId: string,
  params: Record<string, unknown>,
): Promise<StripeObject[]> {
  const res = await fetch(
    `https://backend.composio.dev/api/v3/actions/${action}/execute`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ entity_id: entityId, params }),
    },
  ).catch(() => null)
  if (!res || !res.ok) return []
  const payload = (await res.json()) as ComposioListResponse
  if (!payload.successful) return []
  // Stripe returns list responses wrapped as { object:'list', data:[...] }.
  // Composio wraps everything in { data: {...} }. So the typical shape is
  // payload.data.data[] — but tolerate variants that return an array directly
  // or payload.data[] without the inner wrapper.
  const outer = payload.data as unknown
  if (Array.isArray(outer)) return outer as StripeObject[]
  if (outer && typeof outer === 'object') {
    const inner = (outer as { data?: unknown }).data
    if (Array.isArray(inner)) return inner as StripeObject[]
  }
  return []
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const since = url.searchParams.get('since') ?? ''

  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: integration } = await sb
    .from('integrations')
    .select('provider, status')
    .eq('client_id', auth.clientId)
    .eq('provider', 'stripe')
    .eq('status', 'connected')
    .single()

  if (!integration) {
    return NextResponse.json(
      { error: 'stripe not connected', events: [] },
      { status: 409 },
    )
  }

  let createdGte: number | undefined
  if (since) {
    const d = new Date(since)
    if (!isNaN(d.valueOf())) createdGte = Math.floor(d.getTime() / 1000)
  }

  const commonParams: Record<string, unknown> = {
    limit: 50,
    ...(createdGte ? { created: { gte: createdGte } } : {}),
  }

  // Parallel fetch of 5 Stripe resource lists
  const [charges, refunds, invoices, subscriptions, paymentIntents] = await Promise.all([
    callComposio('STRIPE_LIST_CHARGES', auth.clientId, commonParams),
    callComposio('STRIPE_LIST_REFUNDS', auth.clientId, commonParams),
    callComposio('STRIPE_LIST_INVOICES', auth.clientId, commonParams),
    callComposio('STRIPE_LIST_SUBSCRIPTIONS', auth.clientId, commonParams),
    callComposio('STRIPE_LIST_PAYMENT_INTENTS', auth.clientId, commonParams),
  ])

  const events: SimEvent[] = []

  // Charges → charge.failed (if failed) or charge.succeeded
  for (const c of charges) {
    if (c.status === 'failed') {
      events.push({
        id: `sim:${c.id}`,
        type: 'charge.failed',
        created: (c.created as number) ?? 0,
        data: { object: c },
      })
    }
    if ((c as { dispute?: unknown }).dispute) {
      events.push({
        id: `sim:${c.id}:dispute`,
        type: 'charge.dispute.created',
        created: (c.created as number) ?? 0,
        data: { object: c },
      })
    }
  }

  // Refunds → charge.refunded when >£500 (scanner's threshold)
  for (const r of refunds) {
    events.push({
      id: `sim:${r.id}`,
      type: 'charge.refunded',
      created: (r.created as number) ?? 0,
      data: { object: r },
    })
  }

  // Invoices → invoice.payment_failed
  for (const inv of invoices) {
    if (inv.status === 'payment_failed' || inv.status === 'uncollectible') {
      events.push({
        id: `sim:${inv.id}`,
        type: 'invoice.payment_failed',
        created: (inv.created as number) ?? 0,
        data: { object: inv },
      })
    }
  }

  // Subscriptions → customer.subscription.created (if created since)
  for (const s of subscriptions) {
    events.push({
      id: `sim:${s.id}`,
      type: 'customer.subscription.created',
      created: (s.created as number) ?? 0,
      data: { object: s },
    })
  }

  // PaymentIntents → can reveal payment failures too
  for (const pi of paymentIntents) {
    if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
      events.push({
        id: `sim:${pi.id}`,
        type: 'payment_intent.payment_failed',
        created: (pi.created as number) ?? 0,
        data: { object: pi },
      })
    }
  }

  // Sort newest first
  events.sort((a, b) => b.created - a.created)

  return NextResponse.json({ count: events.length, events })
}
