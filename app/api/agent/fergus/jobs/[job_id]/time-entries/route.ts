import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/time-entries
 *
 * Log labour hours against a job. Used during training + on-site reporting:
 *   "I did 3h at Smith Rd today" → agent calls this.
 *
 * Body:
 *   {
 *     hours: number (>0, <=24),
 *     date?: "YYYY-MM-DD",        // defaults today (UK local)
 *     user_id?: number,           // Fergus user; defaults to PAT owner
 *     description?: string,       // what was done
 *     is_billable?: boolean       // default true
 *   }
 */

const Body = z.object({
  hours: z.number().gt(0).lte(24),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  user_id: z.number().int().positive().optional(),
  description: z.string().max(500).optional(),
  is_billable: z.boolean().optional(),
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
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const entry = await client.addTimeEntry(id, {
      hours: d.hours,
      date: d.date,
      userId: d.user_id,
      description: d.description,
      isBillable: d.is_billable,
    })
    return NextResponse.json({ time_entry: entry })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_time_entry_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
