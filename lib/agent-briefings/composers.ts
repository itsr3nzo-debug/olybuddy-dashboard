/**
 * Briefing + chase + guard composers. Each returns a summary object that a
 * cron route turns into an integration_signals row the VPS agent picks up.
 *
 * Design rule: composers ONLY read — they never mutate Fergus/Xero/Supabase
 * directly. Any action (send WhatsApp, hold a job, void a quote) is taken
 * by the downstream agent after owner approval. Keeps the blast radius small
 * and all owner-in-the-loop decisions auditable via integration_signals.
 */

import { FergusClient } from '@/lib/integrations/fergus'
import { XeroClient } from '@/lib/integrations/xero'
import { gbp } from './emit'

export interface BriefSummary {
  /** Owner-facing message. Agent forwards this verbatim or lightly tone-adjusted. */
  summary: string
  /** Stable string used to dedup signal_id across repeat runs in the same window. */
  dedupKey: string
  /** Raw data so agent can act on it without re-fetching. */
  context: Record<string, unknown>
  /** Higher than normal when immediate action needed. */
  urgency?: 'low' | 'normal' | 'urgent'
  /** If false, caller should skip emitting a signal. */
  hasContent: boolean
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. MORNING BRIEF — 6:30am daily
// ═════════════════════════════════════════════════════════════════════════════

export async function composeMorningBrief(clientId: string): Promise<BriefSummary> {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const context: Record<string, unknown> = { date: today }
  const lines: string[] = [`Morning — your brief for ${formatDateUK(today)}:`]

  // Fergus: today's ACTUAL diary (calendar events) — not "all open jobs"
  // (which was the lazy earlier implementation that counted everything active
  // regardless of schedule date).
  let todayEventCount = 0
  let openJobCount = 0
  try {
    const fergus = await FergusClient.forClient(clientId)
    const events = await fergus.listCalendarEvents({ dateFrom: today, dateTo: today }).catch(() => [])
    todayEventCount = events.length
    context.today_events = events.slice(0, 10)
    if (events.length > 0) {
      const preview = events.slice(0, 4).map((e) => {
        const r = e as { eventTitle?: string; startTime?: string }
        const t = r.startTime ? new Date(r.startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''
        return `${t ? t + ' ' : ''}${r.eventTitle ?? 'event'}`
      })
      lines.push(`• Today's diary: ${preview.join(' · ')}${events.length > 4 ? `, +${events.length - 4} more` : ''}`)
    } else {
      // No diary entries — fall back to open job count (useful signal even if nothing booked)
      const openJobs = await fergus.listOpenJobs(10).catch(() => [])
      openJobCount = openJobs.length
      context.open_jobs = openJobs.slice(0, 5)
      if (openJobs.length > 0) {
        lines.push(`• No diary entries today — but ${openJobs.length} active job${openJobs.length === 1 ? '' : 's'} on the go.`)
      }
    }
  } catch { /* fergus not connected */ }

  // Xero: yesterday's payments in
  let paymentsCount = 0
  let paymentsTotal = 0
  try {
    const xero = await XeroClient.forClient(clientId)
    const yesterdayTxns = await xero.getBankTransactions({ dateFrom: yesterday }).catch(() => [] as unknown[])
    if (Array.isArray(yesterdayTxns)) {
      const typed = yesterdayTxns as Array<{ Type?: string; Total?: number }>
      const incoming = typed.filter((t) => t.Type === 'RECEIVE')
      paymentsCount = incoming.length
      paymentsTotal = incoming.reduce((s, t) => s + (t.Total ?? 0), 0)
      context.payments_yesterday = { count: paymentsCount, total: paymentsTotal }
      if (paymentsCount > 0) {
        lines.push(`• Payments in yesterday: ${paymentsCount} × ${gbp(paymentsTotal)}`)
      }
    }
  } catch { /* xero not connected */ }

  if (lines.length === 1) {
    lines.push('• Quiet morning — no open jobs, no payments overnight. Good time for admin?')
  } else {
    lines.push('', 'Say "full" for details on any of these.')
  }

  return {
    summary: lines.join('\n'),
    dedupKey: `morning:${today}`,
    context,
    urgency: 'normal',
    hasContent: todayEventCount > 0 || openJobCount > 0 || paymentsCount > 0,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. WEEKLY BRIEF — Friday 5pm
// ═════════════════════════════════════════════════════════════════════════════

export async function composeWeeklyBrief(clientId: string): Promise<BriefSummary> {
  const weekEnd = new Date().toISOString().slice(0, 10)
  const weekStart = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const lines: string[] = [`Week ending ${formatDateUK(weekEnd)} — wrap:`]
  const context: Record<string, unknown> = { week_start: weekStart, week_end: weekEnd }

  let invoiced = 0
  let overdue = 0

  // Xero: invoices raised this week + overdue total
  try {
    const xero = await XeroClient.forClient(clientId)
    const invs = await xero.listInvoices({ dateFrom: weekStart }).catch(() => [])
    if (invs && Array.isArray(invs)) {
      invoiced = invs.reduce((s: number, i: { Total?: number }) => s + (i.Total ?? 0), 0)
      context.invoices_this_week = { count: invs.length, total: invoiced }
      lines.push(`• Invoiced this week: ${invs.length} × ${gbp(invoiced)}`)
    }
    const overdueInvs = await xero.listOverdueInvoices().catch(() => [])
    if (overdueInvs && Array.isArray(overdueInvs)) {
      overdue = overdueInvs.reduce((s: number, i: { AmountDue?: number }) => s + (i.AmountDue ?? 0), 0)
      context.overdue = { count: overdueInvs.length, total: overdue }
      if (overdueInvs.length > 0) {
        lines.push(`• Overdue (>due): ${overdueInvs.length} invoices = ${gbp(overdue)} — want me to chase?`)
      }
    }
  } catch { /* xero not connected */ }

  // Fergus: jobs completed this week (from poller-emitted signals)
  // (Kept simple — could query fergus_job_completed signals from integration_signals later.)

  if (lines.length === 1) {
    lines.push('• Nothing to report this week — Xero not connected or quiet.')
  } else {
    lines.push('', 'Full P&L in the dashboard if you want the detail.')
  }

  return {
    summary: lines.join('\n'),
    dedupKey: `weekly:${weekEnd}`,
    context,
    urgency: 'normal',
    hasContent: invoiced > 0 || overdue > 0,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. DEPOSIT-BEFORE-START GUARD — called per-job before scheduled start
// ═════════════════════════════════════════════════════════════════════════════

export async function composeDepositGuard(
  clientId: string,
  args: { jobId: number; quoteTotal: number; scheduledStart: string },
): Promise<BriefSummary> {
  const { jobId, quoteTotal, scheduledStart } = args
  const threshold = 500
  if (quoteTotal < threshold) {
    return { summary: '', dedupKey: `deposit:${jobId}`, context: {}, hasContent: false }
  }

  // Check Xero for any payment received against this job reference
  let receivedTotal = 0
  try {
    const xero = await XeroClient.forClient(clientId)
    const invs = await xero.listInvoices().catch(() => [])
    // Best-effort: look for an invoice referencing the job number
    if (invs && Array.isArray(invs)) {
      const matching = invs.filter((i: { Reference?: string }) => i.Reference?.includes(`${jobId}`))
      receivedTotal = matching.reduce((s: number, i: { AmountPaid?: number }) => s + (i.AmountPaid ?? 0), 0)
    }
  } catch { /* xero not connected */ }

  const depositExpected = Math.round(quoteTotal * 0.25)
  if (receivedTotal >= depositExpected) {
    return { summary: '', dedupKey: `deposit:${jobId}`, context: { job_id: jobId, ok: true }, hasContent: false }
  }

  return {
    summary: [
      `⚠️ Job ${jobId} is scheduled to start ${formatDateUK(scheduledStart)} with no deposit received.`,
      `Quote total ${gbp(quoteTotal)} — 25% deposit = ${gbp(depositExpected)}. Received so far: ${gbp(receivedTotal)}.`,
      'Reply "hold" to put the job on hold, "bill" to send a deposit invoice, or "proceed" to let it run anyway.',
    ].join('\n'),
    dedupKey: `deposit:${jobId}:${scheduledStart}`,
    context: { job_id: jobId, quote_total: quoteTotal, deposit_expected: depositExpected, received: receivedTotal, scheduled_start: scheduledStart },
    urgency: 'urgent',
    hasContent: true,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. QUOTE-CHASE SEQUENCE — runs every 6h; checks quotes by age bucket
// ═════════════════════════════════════════════════════════════════════════════

export async function composeQuoteChase(clientId: string): Promise<BriefSummary[]> {
  const out: BriefSummary[] = []
  try {
    const fergus = await FergusClient.forClient(clientId)
    // Correct logic: for each open job, fetch its quotes. A chaseable quote is
    // one that's been **published + marked sent** but NOT accepted, and was sent
    // more than 3 days ago. (Previously was checking job.status which is
    // OWNER-pending-action status, not customer-waiting — would have chased
    // customers for the owner's own todos.)
    const jobs = await fergus.listOpenJobs(25).catch(() => [])
    const today = new Date().toISOString().slice(0, 10)

    for (const j of jobs) {
      const raw = j as unknown as { id?: number; jobNo?: string; title?: string }
      if (!raw.id) continue
      // Fetch the job's quotes — uses Fergus /jobs/{id}/quotes (exists in Partner API)
      const jobDetail = await fergus.getJob(raw.id).catch(() => null)
      const quotes = (jobDetail as unknown as { quotes?: Array<Record<string, unknown>> } | null)?.quotes ?? []

      for (const q of quotes) {
        const isSent = q.isSent === true || typeof q.sentAt === 'string'
        const isAccepted = q.isAccepted === true || typeof q.acceptedAt === 'string'
        const isDeclined = q.isDeclined === true || typeof q.declinedAt === 'string'
        if (!isSent || isAccepted || isDeclined) continue

        const sentAt = (q.sentAt as string | undefined) ?? (q.publishedAt as string | undefined)
        if (!sentAt) continue
        const daysSinceSent = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000)
        // Cadence: chase at 3d, 7d, 14d — not every day after that
        if (![3, 7, 14].includes(daysSinceSent)) continue

        const quoteTitle = (q.title as string | undefined) ?? raw.title
        const quoteTotal = (q.total as number | undefined) ?? (q.totalSell as number | undefined)
        out.push({
          summary: `Quote${quoteTitle ? ` "${quoteTitle}"` : ''} for job ${raw.jobNo ?? raw.id} went ${daysSinceSent} days ago with no reply${quoteTotal ? ` (${gbp(quoteTotal)})` : ''}. Worth a nudge? Say "chase ${raw.jobNo ?? raw.id}" and I'll draft a friendly follow-up.`,
          dedupKey: `quote-chase:${q.id}:${daysSinceSent}d:${today}`,
          context: { job_id: raw.id, job_no: raw.jobNo, quote_id: q.id, days_since_sent: daysSinceSent, total: quoteTotal },
          urgency: daysSinceSent >= 14 ? 'normal' : 'low',
          hasContent: true,
        })
      }
    }
  } catch { /* fergus not connected */ }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. AGED-DEBTOR CHASE — runs nightly
// ═════════════════════════════════════════════════════════════════════════════

export async function composeAgedDebtorChase(clientId: string): Promise<BriefSummary> {
  try {
    const xero = await XeroClient.forClient(clientId)
    const overdue = await xero.listOverdueInvoices?.().catch(() => [])
    if (!overdue || !Array.isArray(overdue) || overdue.length === 0) {
      return { summary: '', dedupKey: `aged:${new Date().toISOString().slice(0, 10)}`, context: {}, hasContent: false }
    }

    const today = new Date()
    const buckets = { '7': 0, '14': 0, '30': 0, '60+': 0 }
    const totals = { '7': 0, '14': 0, '30': 0, '60+': 0 }
    for (const inv of overdue) {
      const i = inv as { DueDate?: string; AmountDue?: number }
      if (!i.DueDate) continue
      const due = new Date(i.DueDate)
      const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
      const bucket: keyof typeof buckets = daysOverdue >= 60 ? '60+' : daysOverdue >= 30 ? '30' : daysOverdue >= 14 ? '14' : '7'
      buckets[bucket]++
      totals[bucket] += i.AmountDue ?? 0
    }
    const total = Object.values(totals).reduce((a, b) => a + b, 0)

    // Per-invoice detail with customer names (was aggregate-only before — useless for action)
    const topLines: string[] = []
    const sorted = [...overdue].sort((a, b) => {
      const bd = new Date((b as { DueDate?: string }).DueDate ?? '').getTime()
      const ad = new Date((a as { DueDate?: string }).DueDate ?? '').getTime()
      return ad - bd  // oldest first
    })
    for (const inv of sorted.slice(0, 6)) {
      const i = inv as { DueDate?: string; AmountDue?: number; Contact?: { Name?: string }; InvoiceNumber?: string }
      if (!i.DueDate) continue
      const days = Math.max(0, Math.floor((today.getTime() - new Date(i.DueDate).getTime()) / 86_400_000))
      const name = i.Contact?.Name ?? 'Unknown'
      topLines.push(`  • ${name} — ${gbp(i.AmountDue)} (${days}d overdue${i.InvoiceNumber ? ', ' + i.InvoiceNumber : ''})`)
    }

    const lines = [
      `💷 You're owed ${gbp(total)} across ${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}:`,
      ...topLines,
    ]
    if (overdue.length > 6) lines.push(`  • +${overdue.length - 6} more`)
    lines.push('', 'Reply "chase all" to send reminders, or "chase 30+" to only hit the older ones.')

    return {
      summary: lines.join('\n'),
      dedupKey: `aged:${new Date().toISOString().slice(0, 10)}`,
      context: { overdue_count: overdue.length, total, buckets, totals },
      urgency: total > 3000 ? 'urgent' : 'normal',
      hasContent: true,
    }
  } catch {
    return { summary: '', dedupKey: 'aged:error', context: {}, hasContent: false }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. JOB PROFIT GUARD — called when a signal says labour/materials changed
// ═════════════════════════════════════════════════════════════════════════════

export async function composeProfitGuard(
  clientId: string,
  args: { jobId: number },
): Promise<BriefSummary> {
  try {
    const fergus = await FergusClient.forClient(clientId)
    const summary = await fergus.getJobFinancialSummary(args.jobId)
    if (!summary) return { summary: '', dedupKey: `profit:${args.jobId}`, context: {}, hasContent: false }

    const s = summary as Record<string, unknown>
    const quoted = Number(s.totalSell ?? 0)
    const costs = Number(s.totalCost ?? 0)
    if (!quoted) return { summary: '', dedupKey: `profit:${args.jobId}`, context: {}, hasContent: false }
    const pctUsed = Math.round((costs / quoted) * 100)

    let threshold: 'ok' | 'warn' | 'stop' = 'ok'
    if (pctUsed >= 100) threshold = 'stop'
    else if (pctUsed >= 90) threshold = 'warn'
    else if (pctUsed >= 70) threshold = 'ok' // silent log only — not emitted
    else return { summary: '', dedupKey: `profit:${args.jobId}`, context: {}, hasContent: false }

    if (threshold === 'ok') return { summary: '', dedupKey: `profit:${args.jobId}`, context: {}, hasContent: false }

    const job = await fergus.getJob(args.jobId)
    const jobNo = (job as unknown as { jobNo?: string })?.jobNo

    const msgs = {
      warn: `⚠️ Job ${jobNo ?? args.jobId} has used ${pctUsed}% of its budget (${gbp(costs)} of ${gbp(quoted)}). Keep an eye — only ${gbp(quoted - costs)} headroom left.`,
      stop: `🔴 Job ${jobNo ?? args.jobId} has HIT or EXCEEDED its quoted price (${gbp(costs)} of ${gbp(quoted)}). Every £ from here is your margin gone. Raise a variation quote or absorb?`,
    }

    return {
      summary: msgs[threshold],
      dedupKey: `profit:${args.jobId}:${threshold}`,
      context: { job_id: args.jobId, quoted, costs, pct_used: pctUsed, threshold },
      urgency: threshold === 'stop' ? 'urgent' : 'normal',
      hasContent: true,
    }
  } catch {
    return { summary: '', dedupKey: `profit:${args.jobId}`, context: {}, hasContent: false }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. SERVICE RECALL — boilers @ 12mo, CP12 @ 12mo, EICR @ 60mo
// ═════════════════════════════════════════════════════════════════════════════

interface FergusJobRecord { id?: number; jobNo?: string; title?: string; description?: string; customerId?: number; createdAt?: string }

export async function composeServiceRecalls(clientId: string): Promise<BriefSummary[]> {
  const out: BriefSummary[] = []
  try {
    const fergus = await FergusClient.forClient(clientId)
    // Correct logic: use the LATEST invoice date for that job, not createdAt.
    // Rationale: a boiler is installed → invoiced when finished → that invoice
    // date is the installation moment. createdAt is when the job was LOGGED
    // in Fergus, which could be weeks before install, or (for migrated data)
    // years before. Previously: a newly-migrated historical job would fire
    // "service due" on day 1.
    //
    // Fergus exposes invoices per job via `GET /customerInvoices?jobId=` (v1).
    // For now we still walk searchJobs but prefer the invoice-date field if
    // Fergus populated one on the job response (common when a job has been
    // fully invoiced). Fall back to createdAt ONLY if no invoice date + flag
    // uncertainty in the context so the agent can hedge in its reply.
    const completed = await fergus.searchJobs('', 50).catch(() => [])
    const now = Date.now()

    for (const j of completed) {
      const raw = j as unknown as FergusJobRecord & {
        invoicedAt?: string        // some Fergus responses include this
        completedAt?: string
        status?: string
      }
      const combined = `${raw.title ?? ''} ${raw.description ?? ''}`.toLowerCase()
      if (!raw.customerId) continue

      // Use best available "when was this actually done" signal
      const referenceDate = raw.invoicedAt ?? raw.completedAt ?? raw.createdAt
      const dateSource = raw.invoicedAt ? 'invoiced' : raw.completedAt ? 'completed' : 'created'
      if (!referenceDate) continue

      // Only consider jobs that are actually completed / invoiced — skip drafts
      if (raw.status && !['Completed', 'Invoiced', 'Closed', 'Paid'].includes(raw.status)) continue

      const ageMs = now - new Date(referenceDate).getTime()
      const ageMonths = ageMs / (30 * 86_400_000)

      let tag: string | null = null
      let target = 12
      if (/boiler/i.test(combined) && /(install|service|new)/i.test(combined)) { tag = 'boiler service'; target = 12 }
      else if (/cp12|gas\s*safe|gas\s*cert|landlord\s*gas/i.test(combined)) { tag = 'CP12 gas cert'; target = 12 }
      else if (/eicr|electrical\s*install(ation)?\s*condition/i.test(combined)) { tag = 'EICR'; target = 60 }
      else if (/pat\s*test/i.test(combined)) { tag = 'PAT test'; target = 12 }

      if (!tag) continue
      // Nudge window: between (target - 1.5mo) and (target - 0.5mo)
      if (ageMonths < target - 1.5 || ageMonths > target - 0.5) continue

      const hedge = dateSource === 'created' ? ' (date is approximate — based on job-creation, not invoice)' : ''
      out.push({
        summary: `🔔 Customer (Fergus customer ${raw.customerId}) is due for ${tag} in ~${Math.round(target - ageMonths)} weeks${hedge} (original job ${raw.jobNo ?? raw.id}). Want me to draft a booking-reminder message?`,
        dedupKey: `recall:${raw.id}:${tag}`,
        context: { job_id: raw.id, customer_id: raw.customerId, service: tag, target_months: target, age_months: Math.round(ageMonths * 10) / 10, date_source: dateSource },
        urgency: 'low',
        hasContent: true,
      })
    }
  } catch { /* fergus not connected */ }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. REVIEW REQUEST AFTER PAID — 48h after a bank transaction matches an invoice
// ═════════════════════════════════════════════════════════════════════════════

export async function composeReviewRequest(
  clientId: string,
  args: { invoiceId: string; customerName: string; customerPhone?: string; amount: number; paidAt: string },
): Promise<BriefSummary> {
  const daysSincePaid = Math.floor((Date.now() - new Date(args.paidAt).getTime()) / 86_400_000)
  if (daysSincePaid < 2) {
    return { summary: '', dedupKey: `review:${args.invoiceId}`, context: {}, hasContent: false }
  }
  return {
    summary: [
      `${args.customerName} paid their ${gbp(args.amount)} invoice 2 days ago. Ripe time to ask for a Google review.`,
      `Want me to send a friendly review request? Reply "yes" and I'll draft it.`,
    ].join('\n'),
    dedupKey: `review:${args.invoiceId}`,
    context: args,
    urgency: 'low',
    hasContent: true,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// helpers
// ═════════════════════════════════════════════════════════════════════════════

function formatDateUK(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', weekday: 'long' })
}
