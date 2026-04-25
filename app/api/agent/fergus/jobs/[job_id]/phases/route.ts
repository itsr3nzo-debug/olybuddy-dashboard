import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { z } from 'zod'

/**
 * GET  /api/agent/fergus/jobs/<id>/phases
 *   Lists the phases on a job. Phases are the buckets that line items
 *   live in (Fergus stores stockOnHand on phases, not directly on jobs).
 *   Returns `{ phases: [{id, title, ...}] }`. Use the ids with
 *   POST /jobs/<id>/line-items { phase_id } to target a specific phase.
 *
 * POST /api/agent/fergus/jobs/<id>/phases
 *   Body: { title: string, description?: string }
 *   Creates a new phase on the job. Returns `{ phase: {id, title, ...} }`.
 *   Useful when the agent wants to seed named buckets ("Labour",
 *   "Materials") before adding line items.
 *
 * Both endpoints are authenticated like the rest of /api/agent/fergus.
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const phases = await client.listJobPhases(id)
    // Project to a stable shape: id (number) + title + description if present.
    // We deliberately keep the original object too under `_raw` so an agent
    // that needs an unmapped Fergus field doesn't have to make a second call.
    const projected = phases.map(p => ({
      id: (p.id ?? (p as { jobPhaseId?: number }).jobPhaseId) as number | undefined,
      title: ((p.title as string | undefined) ?? (p.name as string | undefined) ?? '').trim() || null,
      description: (p.description as string | undefined) ?? null,
      _raw: p,
    }))
    return NextResponse.json({ count: projected.length, phases: projected })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_list_phases_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const phase = await client.createJobPhase(id, {
      title: parsed.data.title.trim(),
      description: parsed.data.description?.trim(),
    })
    const phaseId = (phase.id ?? (phase as { jobPhaseId?: number }).jobPhaseId) as number | undefined
    return NextResponse.json({
      phase: {
        id: phaseId,
        title: ((phase.title as string | undefined) ?? parsed.data.title).trim(),
        description: (phase.description as string | undefined) ?? null,
        _raw: phase,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_create_phase_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
