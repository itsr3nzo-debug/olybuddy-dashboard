import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/log-labour
 *
 * Workaround D — the compliant substitute for Fergus's missing
 * `POST /jobs/{id}/time-entries`. Writes a BILLABLE labour line to a
 * phase's stockOnHand with `isLabour=true` (this is what makes labour
 * show up on the invoice). Also records a shadow entry in the
 * fergus_time_shadow table so we can nudge the owner to backfill
 * Fergus Go for payroll/timesheet reconciliation.
 *
 * Body: `{hours, rate?, phase_id?, description?, date?, price_book_line_item_id?}`
 *   - hours: decimal, 0 < h <= 24 (required)
 *   - rate: £/hr. If omitted we try integrations.metadata.default_labour_rate
 *           for the client, then fall back to 0 (line still written, just
 *           unpriced — owner can set in Fergus UI).
 *   - phase_id: target phase. If omitted, picks the first non-voided phase
 *               on the job (the common case for one-phase jobs).
 *   - description: free-text. Default: "Labour — YYYY-MM-DD"
 *   - date: YYYY-MM-DD for the shadow entry. Defaults to today.
 *   - price_book_line_item_id: optional — if the client has a standard
 *           "Hourly Labour" pricebook item set up, pass its id here and
 *           Fergus uses the pricebook's rate.
 *
 * What the agent WhatsApp-replies with:
 *   "Logged 3h billable on Smith Rd (phase 'Main', £75/hr = £225).
 *    Reminder to add to Fergus Go timesheet tonight — I'll nudge you at 6pm."
 */

const Body = z.object({
  hours: z.number().gt(0).lte(24),
  rate: z.number().min(0).max(10_000).optional(),
  phase_id: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  price_book_line_item_id: z.number().int().positive().optional(),
})

type PhaseRow = { id?: number; title?: string; isVoided?: boolean; status?: string }
type StockCreated = { data?: { id?: number }; id?: number }

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const jobId = parseInt(job_id, 10)
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data

  try {
    const sb = supa()

    // Resolve default rate from the client's integration metadata if not passed
    let rate = d.rate
    if (rate === undefined) {
      const { data: integ } = await sb
        .from('integrations')
        .select('metadata')
        .eq('client_id', auth.clientId)
        .eq('provider', 'fergus')
        .eq('status', 'connected')
        .maybeSingle()
      const defRate = (integ?.metadata as { default_labour_rate?: number } | null)?.default_labour_rate
      if (typeof defRate === 'number') rate = defRate
    }

    const client = await FergusClient.forClient(auth.clientId)

    // Pick phase: either passed in, or first non-voided phase on the job
    let phaseId = d.phase_id
    let phaseTitle: string | undefined
    if (!phaseId) {
      const phases = await client.listJobPhases(jobId) as unknown as PhaseRow[]
      const open = phases.find(p => p.isVoided !== true && p.status !== 'Voided')
      if (!open || !open.id) {
        return NextResponse.json({
          error: 'no_open_phase',
          reason: 'Job has no non-voided phase. Create one first (POST /api/agent/fergus/jobs/{id}/phases) or pass phase_id explicitly.',
          phases_seen: phases.length,
        }, { status: 422 })
      }
      phaseId = open.id
      phaseTitle = open.title
    }

    const date = d.date ?? new Date().toISOString().slice(0, 10)
    const description = d.description ?? `Labour — ${date}`

    // Write the labour line to Fergus. addPhaseStockOnHand handles the
    // create-then-PATCH dance for isLabour=true.
    const created = await client.addPhaseStockOnHand(phaseId, {
      itemDescription: description,
      itemPrice: rate ?? 0,
      itemQuantity: d.hours,
      isLabour: true,
      priceBookLineItemId: d.price_book_line_item_id,
    }) as StockCreated | null

    const stockId = created?.data?.id ?? created?.id ?? null
    const amount = rate !== undefined ? Number((rate * d.hours).toFixed(2)) : null

    // Fetch jobNo for shadow ledger context
    const job = await client.getJob(jobId).catch(() => null) as unknown as { jobNo?: string } | null

    // Write shadow ledger entry
    const { error: shadowErr, data: shadow } = await sb.from('fergus_time_shadow').insert({
      client_id: auth.clientId,
      job_fergus_id: jobId,
      job_no: job?.jobNo ?? null,
      phase_fergus_id: phaseId,
      phase_stock_on_hand_id: stockId,
      hours: d.hours,
      rate: rate ?? null,
      amount,
      description,
      entry_date: date,
      source: 'agent',
    }).select('id').single()

    return NextResponse.json({
      ok: true,
      fergus: {
        job_id: jobId,
        job_no: job?.jobNo ?? null,
        phase_id: phaseId,
        phase_title: phaseTitle,
        phase_stock_on_hand_id: stockId,
        labour_line: created,
      },
      shadow_entry_id: shadow?.id ?? null,
      shadow_write_error: shadowErr?.message ?? null,
      summary: {
        hours: d.hours,
        rate: rate ?? null,
        amount,
        date,
      },
      reminder: 'Billable labour is on the invoice. For payroll/timesheet accuracy also log in Fergus Go — the agent will nudge you at end of day via /api/agent/fergus/time-shadow/pending.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'log_labour_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
