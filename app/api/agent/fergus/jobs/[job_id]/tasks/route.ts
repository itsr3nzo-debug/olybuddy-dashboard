import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/tasks
 *
 * Add a task (checklist item) to a job. Typical use: role-specific
 * checklists from the agent — e.g.
 *   "Julian: test RCD at CU"
 *   "James: label final circuits"
 *
 * Body:
 *   {
 *     title: string (req, <=200),
 *     description?: string,
 *     assignee_user_id?: number,   // Fergus user id
 *     due_date?: "YYYY-MM-DD",
 *     completed?: boolean           // default false
 *   }
 */

const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignee_user_id: z.number().int().positive().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completed: z.boolean().optional(),
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
    const task = await client.addJobTask(id, {
      title: d.title,
      description: d.description,
      assigneeUserId: d.assignee_user_id,
      dueDate: d.due_date,
      completed: d.completed,
    })
    return NextResponse.json({ task })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_job_task_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
