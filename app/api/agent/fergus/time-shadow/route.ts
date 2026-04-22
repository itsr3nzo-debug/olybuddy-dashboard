import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'

/**
 * GET  /api/agent/fergus/time-shadow?date=YYYY-MM-DD&synced=false
 * POST /api/agent/fergus/time-shadow/mark-synced
 *
 * Workaround D — shadow timesheet ledger.
 *
 * Every "I did 3h on Smith Rd" the agent captures is written to the
 * fergus_time_shadow table (alongside the Fergus phase-labour line).
 * This lets the agent produce an end-of-day summary + Fergus Go deeplink
 * nudge so payroll/timesheet data stays accurate even though we can't
 * write time entries to the Fergus Partner API.
 *
 * GET usage — end-of-day nudge:
 *   /api/agent/fergus/time-shadow?date=2026-04-22&synced=false
 *   → returns every agent-logged entry the owner hasn't marked as
 *     backfilled to Fergus Go yet, with a single WhatsApp-ready
 *     summary line.
 *
 * POST usage — owner confirms they logged in Fergus Go:
 *   body: {entry_ids: [123, 124]} — marks those rows synced.
 *   body: {all_up_to_date: "2026-04-22"} — marks everything ≤ that date.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const sp = new URL(req.url).searchParams
  const date = sp.get('date') // optional
  const syncedParam = sp.get('synced')

  const sb = supa()
  let q = sb
    .from('fergus_time_shadow')
    .select('id, job_fergus_id, job_no, phase_fergus_id, hours, rate, amount, description, entry_date, synced_to_fergus_go, synced_at, created_at')
    .eq('client_id', auth.clientId)
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(100)

  if (date) q = q.eq('entry_date', date)
  if (syncedParam === 'true') q = q.eq('synced_to_fergus_go', true)
  if (syncedParam === 'false') q = q.eq('synced_to_fergus_go', false)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: 'query_failed', detail: error.message }, { status: 500 })
  }

  const rows = data ?? []
  const totalHours = rows.reduce((s, r) => s + Number(r.hours), 0)
  const totalAmount = rows.reduce((s, r) => s + (r.amount ? Number(r.amount) : 0), 0)

  // Group by job for the nudge message
  type Row = typeof rows[number]
  const byJob = new Map<string, { job_no: string | null; job_fergus_id: number | null; hours: number }>()
  for (const r of rows as Row[]) {
    const key = r.job_no ?? String(r.job_fergus_id ?? 'unknown')
    const cur = byJob.get(key) ?? { job_no: r.job_no, job_fergus_id: r.job_fergus_id, hours: 0 }
    cur.hours += Number(r.hours)
    byJob.set(key, cur)
  }
  const jobSummary = [...byJob.values()]
    .map(j => `${j.job_no ?? `job#${j.job_fergus_id}`}: ${j.hours}h`)
    .join(', ')

  const unsyncedCount = rows.filter(r => !r.synced_to_fergus_go).length
  const whatsappNudge = unsyncedCount > 0
    ? `You've got ${totalHours}h of unlogged time (${jobSummary}). Tap to open Fergus Go and add them: https://my.fergus.com/app/timesheets`
    : 'All logged time is backfilled to Fergus Go 👍'

  return NextResponse.json({
    count: rows.length,
    total_hours: totalHours,
    total_amount: Number(totalAmount.toFixed(2)),
    unsynced_count: unsyncedCount,
    by_job: [...byJob.values()],
    entries: rows,
    whatsapp_nudge: whatsappNudge,
  })
}

const MarkSyncedBody = z.object({
  entry_ids: z.array(z.number().int().positive()).max(500).optional(),
  all_up_to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(b => (b.entry_ids && b.entry_ids.length > 0) || !!b.all_up_to_date, {
  message: 'pass either entry_ids[] or all_up_to_date',
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = MarkSyncedBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const sb = supa()
  const now = new Date().toISOString()
  let q = sb
    .from('fergus_time_shadow')
    .update({ synced_to_fergus_go: true, synced_at: now, updated_at: now })
    .eq('client_id', auth.clientId)
    .eq('synced_to_fergus_go', false)

  if (parsed.data.entry_ids?.length) {
    q = q.in('id', parsed.data.entry_ids)
  } else if (parsed.data.all_up_to_date) {
    q = q.lte('entry_date', parsed.data.all_up_to_date)
  }

  const { error, data } = await q.select('id')
  if (error) {
    return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 })
  }
  return NextResponse.json({ marked_synced: data?.length ?? 0, ids: (data ?? []).map(r => r.id) })
}
