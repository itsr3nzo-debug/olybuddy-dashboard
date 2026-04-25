import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { z } from 'zod'

/**
 * POST /api/agent/fergus/jobs/<id>/line-items
 *
 * Add labour / materials line items to a job. Fergus stores line items
 * on PHASES (not directly on jobs); each phase is a named bucket
 * ("Labour", "Materials", "Site visit 1", …). By default the agent's
 * line items land on the first phase (Fergus auto-creates "Default" if
 * none exists), which was confusing for callers who'd already named
 * sections via the variations endpoint.
 *
 * Targeting (all optional, top-level — applies to every item in the batch):
 *   - phase_id / phaseId         → numeric phase id (skip the lookup)
 *   - phase_name / phaseName     → match phase by title (case-insensitive); auto-create if missing
 *   - section_name / sectionName → alias for phase_name (Julian's terminology)
 *
 * If multiple are sent, phase_id wins, then phase_name, then section_name.
 *
 * To list phases first (and skip the auto-create), use:
 *   GET /api/agent/fergus/jobs/<id>/phases
 */
const Body = z.object({
  // ── Phase target (top-level, applies to all items in the batch) ──
  phase_id: z.number().int().positive().optional(),
  phaseId: z.number().int().positive().optional(),
  phase_name: z.string().min(1).max(100).optional(),
  phaseName: z.string().min(1).max(100).optional(),
  section_name: z.string().min(1).max(100).optional(),
  sectionName: z.string().min(1).max(100).optional(),

  // ── Line items ──
  line_items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive().optional(),
    unit_price: z.number().nonnegative().optional(),
    unit_cost: z.number().nonnegative().optional(),
    item_type: z.enum(['labour', 'materials', 'other']).optional(),
  })).min(1).max(50),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data

  // Resolve phase target — explicit ID wins, then phase_name, then section_name (alias).
  const phaseId = d.phase_id ?? d.phaseId
  const phaseName = d.phase_name ?? d.phaseName ?? d.section_name ?? d.sectionName

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const out = await client.addJobLineItems(
      id,
      d.line_items.map(it => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unit_price,
        unitCost: it.unit_cost,
        itemType: it.item_type,
      })),
      {
        phaseId,
        phaseName,
      },
    )
    return NextResponse.json({
      count: out.results.length,
      phase_id: out.phaseId,
      phase_title: out.phaseTitle ?? null,
      phase_created: out.phaseCreated,
      line_items: out.results,
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_add_line_items_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
