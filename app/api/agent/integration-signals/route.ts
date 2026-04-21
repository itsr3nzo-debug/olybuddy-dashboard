/**
 * Integration signals — VPS-agent → dashboard relay.
 *
 * GET  /api/agent/integration-signals            — list pending signals for the owner
 * POST /api/agent/integration-signals            — VPS agent pushes a new signal
 * PATCH /api/agent/integration-signals/:id       — owner approves/rejects (dashboard UI)
 *
 * Signals originate on the VPS (from /integration-proactive-scan + sub-scanners).
 * The agent POSTs them here so the dashboard can:
 *   (a) Mirror them in Supabase so the owner sees them in the UI, not only WhatsApp
 *   (b) Let the owner tap "approve" / "reject" on a mobile-friendly page
 *   (c) Audit what the agent proposed vs what the owner approved
 *
 * Local DB on the VPS (db/outcome-metrics.sqlite → integration_signals) remains the
 * agent's source of truth. This table is the mirror for the dashboard UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const PostBody = z.object({
  signal_id: z.string().min(4).max(64),
  provider: z.string().min(1).max(40),
  signal_type: z.string().min(1).max(50),
  source_ref: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  urgency: z.enum(['emergency', 'urgent', 'normal', 'low']),
  confidence: z.number().min(0).max(1),
  proposed_action: z.record(z.string(), z.unknown()),
  extracted_context: z.string().max(2000).optional(),
  customer_phone: z.string().optional().nullable(),
})

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * GET — list signals visible to this VPS agent (= its own client's signals)
 * Useful for the agent to re-fetch owner-decisions it needs to action.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const sb = svc()
  const url = new URL(req.url)
  const status = url.searchParams.get('status') // 'new' | 'owner_approved' | 'owner_rejected' | null=all
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)

  let q = sb
    .from('integration_signals')
    .select('*')
    .eq('client_id', auth.clientId)
    .order('detected_at_iso', { ascending: false })
    .limit(limit)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: 'Query failed', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: data?.length ?? 0, signals: data ?? [] })
}

/**
 * POST — VPS agent reports a new signal (mirror to dashboard).
 * Idempotent on `signal_id` — re-posting the same signal_id is a no-op.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = PostBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const sb = svc()

  // Upsert — if signal_id already exists, this is a no-op (don't duplicate)
  const { data, error } = await sb
    .from('integration_signals')
    .upsert(
      {
        client_id: auth.clientId,
        signal_id: parsed.data.signal_id,
        provider: parsed.data.provider,
        signal_type: parsed.data.signal_type,
        source_ref: parsed.data.source_ref,
        summary: parsed.data.summary,
        urgency: parsed.data.urgency,
        confidence: parsed.data.confidence,
        proposed_action: parsed.data.proposed_action,
        extracted_context: parsed.data.extracted_context ?? null,
        customer_phone: parsed.data.customer_phone ?? null,
        status: 'new',
      },
      { onConflict: 'client_id,signal_id', ignoreDuplicates: true },
    )
    .select()

  if (error) {
    return NextResponse.json({ error: 'Insert failed', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, inserted: data?.length ?? 0 })
}
