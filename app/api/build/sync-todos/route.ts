/**
 * POST /api/build/sync-todos
 *
 * Mirrors the agent's current TodoWrite list into `build_progress.todo_snapshot`
 * so the /build/mobile page can render subtasks verbatim (DA D13).
 *
 * Auth: shares CRON_SECRET — used by the agent (me) from the same machine, not
 * exposed publicly. Caller passes Authorization: Bearer ${CRON_SECRET}.
 *
 * Body: {
 *   project_slug?: string,        // default 'mobile'
 *   phase?: string,                // default 'phase1_visibility'
 *   current_task?: string,         // optional update to current_task field
 *   todos: Array<{ content: string, status: 'pending'|'in_progress'|'completed' }>
 * }
 */

import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

interface SyncBody {
  project_slug?: string
  phase?: string
  current_task?: string
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  let body: SyncBody
  try {
    body = (await request.json()) as SyncBody
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }
  if (!Array.isArray(body.todos)) {
    return new Response('todos must be an array', { status: 400 })
  }

  const sb = createUntypedServiceClient()
  const project_slug = body.project_slug ?? 'mobile'
  const phase = body.phase ?? 'phase1_visibility'

  const updates: Record<string, unknown> = {
    todo_snapshot: body.todos,
    updated_at: new Date().toISOString(),
  }
  if (body.current_task) {
    updates.current_task = body.current_task
    updates.current_task_started_at = new Date().toISOString()
  }

  const { error } = await sb
    .from('build_progress')
    .update(updates)
    .eq('project_slug', project_slug)
    .eq('phase', phase)

  if (error) {
    console.error('[build/sync-todos] update failed:', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
