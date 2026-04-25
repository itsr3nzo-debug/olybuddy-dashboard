import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/archive
 *
 * Archive a job — soft-removes from active views (recoverable via /restore).
 * Use case: cleaning up duplicate jobs, abandoned drafts, or jobs created
 * with the wrong jobType.
 *
 * No body required. Idempotent — archiving an already-archived job is a no-op
 * upstream (Fergus returns success).
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
    const job = await client.archiveJob(id)
    return NextResponse.json({ job, action: 'archive' })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_archive_job_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
