import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/variations
 *
 * Add a variation (change order) to a job — extra work the customer asked
 * for mid-job that's on top of the original quote. Fergus tracks these as
 * separate billable line items.
 *
 * Body:
 *   {
 *     title: string (req, <=200),
 *     description?: string,
 *     amount?: number,           // price in major currency units
 *     is_approved?: boolean      // default false (pending owner approval)
 *   }
 *
 * Safety: agent should NEVER set is_approved=true without owner confirmation
 * — the CLAUDE.md "approval required" rules cover this.
 */

const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  amount: z.number().min(0).max(1_000_000).optional(),
  is_approved: z.boolean().optional(),
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
    const variation = await client.addJobVariation(id, {
      title: d.title,
      description: d.description,
      amount: d.amount,
      isApproved: d.is_approved,
    })
    return NextResponse.json({ variation })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_job_variation_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
