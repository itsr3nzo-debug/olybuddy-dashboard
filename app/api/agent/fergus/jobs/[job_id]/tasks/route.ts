import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/tasks
 *
 * Fergus Partner API has NO task-create endpoint. The closest semantic
 * match is a pinned note on the job — notes appear in the timeline and
 * can be assigned-to via @mentions inside the text. This route wraps
 * `POST /notes` with `entityName='job'` and pins the note by default.
 *
 * Body: `{title, description?, assignee_user_id?, due_date?, pin?}` —
 * title + optional context get combined into the note body; assignee and
 * due date are folded into the text (Fergus notes have no dedicated fields
 * for these).
 */
const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignee_user_id: z.number().int().positive().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pin: z.boolean().optional(),
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
    // Compose the note body: title + optional details so it's readable in the timeline.
    const lines = [`📋 ${d.title}`]
    if (d.description) lines.push('', d.description)
    if (d.assignee_user_id) lines.push('', `Assignee: user ${d.assignee_user_id}`)
    if (d.due_date) lines.push(`Due: ${d.due_date}`)
    const note = await client.addNote({
      entityName: 'job',
      entityId: id,
      text: lines.join('\n'),
      isPinned: d.pin ?? true,
    })
    return NextResponse.json({
      task_note: note,
      note: 'Fergus has no native task object in the Partner API — this creates a pinned note on the job instead.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_job_task_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
