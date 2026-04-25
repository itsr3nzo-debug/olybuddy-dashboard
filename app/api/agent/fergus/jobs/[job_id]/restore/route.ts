import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/restore
 *
 * Reverse of /archive. Since /archive is implemented via Fergus's
 * /jobs/{id}/hold (Fergus Partner API has no archive endpoint), restore
 * is implemented via /jobs/{id}/resume. No body required.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const job = await client.restoreJob(id)
    return NextResponse.json({
      job,
      action: 'restore',
      implementation: 'resume',
      note: 'Reversed archive (which was implemented via hold).',
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_restore_job_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
