import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * GET /api/agent/fergus/jobs/<id>/time-entries?date_from&date_to&user_id
 *
 * Fergus Partner API exposes time entries as READ-ONLY (`GET /timeEntries`).
 * Writes are not available — labour logging happens in Fergus Go mobile or
 * the Fergus desktop UI. This endpoint filters by the job's jobNo so you
 * can pull "what has been logged against this job" for reporting/reconciliation.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const sp = new URL(req.url).searchParams
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const job = await client.getJob(id)
    if (!job) return NextResponse.json({ error: 'job not found', job_id: id }, { status: 404 })
    const jobNo = (job as unknown as { jobNo?: string }).jobNo
    const entries = await client.listTimeEntries({
      jobNo,
      dateFrom: sp.get('date_from') ?? undefined,
      dateTo: sp.get('date_to') ?? undefined,
      userId: sp.get('user_id') ? parseInt(sp.get('user_id')!, 10) : undefined,
      pageSize: sp.get('page_size') ? Math.min(100, parseInt(sp.get('page_size')!, 10)) : 50,
    })
    return NextResponse.json({ count: entries.length, time_entries: entries })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_list_time_entries_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

/**
 * POST is NOT SUPPORTED — Fergus Partner API does not expose a time-entry
 * write endpoint. Return 501 with a clear pointer instead of failing silently.
 */
export async function POST() {
  return NextResponse.json({
    error: 'not_supported',
    reason: 'Fergus Partner API has no POST endpoint for time entries. Time logging must happen in Fergus Go (mobile) or the Fergus desktop UI.',
    fergus_endpoint_checked: 'api.fergus.com/docs/json — only GET /timeEntries exists',
    workaround: 'Use GET this URL to read entries; log hours inside Fergus Go.',
  }, { status: 501 })
}
