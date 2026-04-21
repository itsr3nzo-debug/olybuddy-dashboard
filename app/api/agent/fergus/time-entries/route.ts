import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * GET /api/agent/fergus/time-entries?job_no&user_id&date_from&date_to&locked_only&page_size
 *
 * Lists time entries (labour logged against jobs). Fergus Partner API is
 * READ-ONLY for time entries — writes happen in Fergus Go mobile.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const sp = new URL(req.url).searchParams
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const entries = await client.listTimeEntries({
      jobNo: sp.get('job_no') ?? undefined,
      jobPhaseId: sp.get('job_phase_id') ? parseInt(sp.get('job_phase_id')!, 10) : undefined,
      userId: sp.get('user_id') ? parseInt(sp.get('user_id')!, 10) : undefined,
      dateFrom: sp.get('date_from') ?? undefined,
      dateTo: sp.get('date_to') ?? undefined,
      lockedOnly: sp.get('locked_only') === 'true' ? true : sp.get('locked_only') === 'false' ? false : undefined,
      pageSize: sp.get('page_size') ? Math.min(100, parseInt(sp.get('page_size')!, 10)) : 50,
      pageCursor: sp.get('page_cursor') ?? undefined,
    })
    return NextResponse.json({ count: entries.length, time_entries: entries })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_list_time_entries_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
