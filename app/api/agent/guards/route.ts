import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { emitAgentSignal } from '@/lib/agent-briefings/emit'
import { composeProfitGuard, composeDepositGuard, composeReviewRequest } from '@/lib/agent-briefings/composers'

/**
 * POST /api/agent/guards
 *
 * Unified endpoint for event-driven guards. The agent (or the Fergus/Xero
 * poller) calls this when something meaningful happens on a job/invoice:
 *
 *   body: { kind: 'profit', job_id }
 *         { kind: 'deposit', job_id, quote_total, scheduled_start }
 *         { kind: 'review', invoice_id, customer_name, customer_phone?, amount, paid_at }
 *
 * The appropriate composer runs; if it returns a briefing, we emit a signal.
 * Response tells the caller whether a signal was fired so they can log it.
 */

const Body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profit'), job_id: z.number().int().positive() }),
  z.object({
    kind: z.literal('deposit'),
    job_id: z.number().int().positive(),
    quote_total: z.number().positive(),
    scheduled_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal('review'),
    invoice_id: z.string().min(1),
    customer_name: z.string().min(1).max(200),
    customer_phone: z.string().max(40).optional(),
    amount: z.number().positive(),
    paid_at: z.string(),
  }),
])

function supa() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data
  const sb = supa()

  try {
    let brief, signalType: 'fergus_profit_guard' | 'fergus_deposit_guard' | 'review_request_after_paid'
    switch (d.kind) {
      case 'profit':
        brief = await composeProfitGuard(auth.clientId, { jobId: d.job_id })
        signalType = 'fergus_profit_guard'
        break
      case 'deposit':
        brief = await composeDepositGuard(auth.clientId, {
          jobId: d.job_id, quoteTotal: d.quote_total, scheduledStart: d.scheduled_start,
        })
        signalType = 'fergus_deposit_guard'
        break
      case 'review':
        brief = await composeReviewRequest(auth.clientId, {
          invoiceId: d.invoice_id, customerName: d.customer_name,
          customerPhone: d.customer_phone, amount: d.amount, paidAt: d.paid_at,
        })
        signalType = 'review_request_after_paid'
        break
    }

    if (!brief.hasContent) {
      return NextResponse.json({ emitted: false, reason: 'no action needed at this threshold', context: brief.context })
    }

    const r = await emitAgentSignal({
      sb, clientId: auth.clientId, signalType,
      dedupKey: brief.dedupKey, summary: brief.summary,
      urgency: brief.urgency, extractedContext: brief.context,
    })
    return NextResponse.json({ emitted: r.ok, signal_id: r.signalId, summary: brief.summary, urgency: brief.urgency })
  } catch (e) {
    return NextResponse.json({ error: 'guard_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
