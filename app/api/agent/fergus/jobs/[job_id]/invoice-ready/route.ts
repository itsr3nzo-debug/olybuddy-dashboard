import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * GET /api/agent/fergus/jobs/<id>/invoice-ready
 *
 * Workaround D — "prep + one-tap" pattern. Fergus Partner API has no
 * `POST /invoice` endpoint, so we make the invoicing step a single tap
 * for the owner instead of full automation.
 *
 * Returns:
 *   - phase-by-phase summary of what's on the job (line items, labour,
 *     per-phase total, grand total, any warnings)
 *   - a deeplink to the Fergus UI's invoicing screen for this job
 *   - a WhatsApp-ready one-liner the agent can paste to the owner
 *
 * The agent calls this once the job's been done and all line items are
 * captured, then WhatsApps the owner:
 *
 *   "Smith Rd ready to invoice — £2,450 across 3 phases. Tap to confirm
 *    in Fergus: https://my.fergus.com/jobs/12345"
 *
 * One tap in Fergus → invoiced → auto-syncs to Xero.
 */

type PhaseRaw = {
  id?: number
  title?: string
  status?: string
  isVoided?: boolean
}

type FinancialSummary = {
  totalSell?: number
  totalCost?: number
  totalInvoiced?: number
  balanceRemaining?: number
  [k: string]: unknown
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const jobId = parseInt(job_id, 10)
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  try {
    const client = await FergusClient.forClient(auth.clientId)

    const [job, phases, financial] = await Promise.all([
      client.getJob(jobId),
      client.listJobPhases(jobId).catch(() => [] as Array<Record<string, unknown>>),
      client.getJobFinancialSummary(jobId).catch(() => null),
    ])

    if (!job) {
      return NextResponse.json({ error: 'job_not_found', job_id: jobId }, { status: 404 })
    }

    const phaseSummaries = (phases as unknown as PhaseRaw[]).map(p => ({
      phase_id: p.id,
      title: p.title,
      status: p.status,
      is_voided: p.isVoided ?? false,
    }))
    const openPhases = phaseSummaries.filter(p => !p.is_voided && p.status !== 'Voided')

    const fs = (financial ?? {}) as FinancialSummary
    const totalSell = typeof fs.totalSell === 'number' ? fs.totalSell : null
    const totalInvoiced = typeof fs.totalInvoiced === 'number' ? fs.totalInvoiced : null
    const balance = typeof fs.balanceRemaining === 'number' ? fs.balanceRemaining : (totalSell !== null && totalInvoiced !== null ? Number((totalSell - totalInvoiced).toFixed(2)) : null)

    // Deep-link: Fergus's web UI job page. From that page the owner taps
    // "Invoice" to generate the invoice in one click.
    const jobNo = (job as unknown as { jobNo?: string; internal_job_id?: string }).jobNo
    const internalId = (job as unknown as { internal_job_id?: string }).internal_job_id
    const deeplink = internalId
      ? `https://my.fergus.com/jobs/${internalId}`
      : `https://my.fergus.com/jobs/${jobId}`

    const whatsAppSummary = `${(job as { title?: string }).title ?? `Job ${jobNo ?? jobId}`} ready to invoice`
      + (totalSell !== null ? ` — £${totalSell.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '')
      + (openPhases.length ? ` across ${openPhases.length} phase${openPhases.length === 1 ? '' : 's'}` : '')
      + `. Tap to confirm in Fergus: ${deeplink}`

    return NextResponse.json({
      ok: true,
      job: {
        job_id: jobId,
        job_no: jobNo,
        title: (job as { title?: string }).title,
        status: (job as { status?: string }).status,
        is_draft: (job as { isDraft?: boolean }).isDraft ?? false,
      },
      phases: phaseSummaries,
      totals: {
        sell: totalSell,
        invoiced: totalInvoiced,
        balance_remaining: balance,
      },
      deeplink,
      whatsapp_summary: whatsAppSummary,
      next_step_for_owner: 'Open the deeplink → tap the "Invoice" button on the job → Fergus generates the invoice and auto-syncs it to Xero (if connected).',
    })
  } catch (e) {
    return NextResponse.json({ error: 'invoice_ready_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
