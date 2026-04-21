import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/hold
 * Put a job on hold. Body: `{hold_until: "YYYY-MM-DD", notes: string}` — both required by Fergus.
 */
const Body = z.object({
  hold_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'hold_until must be YYYY-MM-DD'),
  notes: z.string().min(1).max(2000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const result = await client.holdJob(id, parsed.data.hold_until, parsed.data.notes)
    return NextResponse.json({ job: result })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_hold_job_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
