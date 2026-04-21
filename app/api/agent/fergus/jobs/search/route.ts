/**
 * GET /api/agent/fergus/jobs/search
 *
 * Read jobs from Fergus. Two modes:
 *   ?jobNo=NXL-1234     — exact/prefix match on Fergus job number
 *   ?open=true&limit=25 — list open (non-draft) jobs, newest first
 *
 * Used by the agent when owner asks "how's job 1234 going" or for the
 * prioritise-pipeline skill's Fergus sync.
 *
 * Returns: { count, jobs: [{ id, jobNo, status, jobType, title, description, isDraft, customerId }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const jobNo = url.searchParams.get('jobNo')?.trim()
  const open = url.searchParams.get('open') === 'true'
  const limitRaw = parseInt(url.searchParams.get('limit') || '25', 10)
  const limit = Math.min(Math.max(limitRaw || 25, 1), 100)

  if (!jobNo && !open) {
    return NextResponse.json({ error: 'pass ?jobNo=... OR ?open=true' }, { status: 400 })
  }

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const jobs = jobNo
      ? await client.searchJobsByNo(jobNo)
      : await client.listOpenJobs(limit)

    return NextResponse.json({
      count: jobs.length,
      jobs: jobs.slice(0, limit).map(j => ({
        id: j.id,
        jobNo: j.jobNo ?? null,
        status: j.status ?? null,
        jobType: j.jobType ?? null,
        title: j.title ?? null,
        description: j.description ?? null,
        isDraft: j.isDraft ?? false,
        customerId: j.customerId ?? null,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_job_search_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
