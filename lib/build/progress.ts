/**
 * Build-progress helpers — used by the AI agent to record what's being built
 * in real time. Drives the /build/{project} page + email digest + screenshots.
 *
 * Discipline: every meaningful chunk of work calls markChunkStart() at the
 * top and markChunkDone() at the bottom. The progress page reads from these
 * tables so the user always knows what's being built without asking.
 *
 * No silence allowed: if I'm working but haven't called markChunkStart, the
 * page shows the last task as still-in-progress and the user gets confused.
 * So: ANY substantive task = a chunk row.
 */

import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export type ChunkStatus = 'in_progress' | 'done' | 'reverted' | 'blocked'
export type TypecheckStatus = 'pending' | 'clean' | 'failed'

export interface ChunkInput {
  project_slug?: string                                 // default 'mobile'
  phase?: string                                        // default 'phase1_visibility'
  title: string
  summary?: string
  files_touched?: string[]
}

export interface ChunkCompletion {
  summary?: string
  commit_sha?: string
  preview_url?: string
  screenshot_urls?: string[]
  loom_url?: string
  typecheck_status?: TypecheckStatus
}

const DEFAULT_PROJECT = 'mobile'
const DEFAULT_PHASE = 'phase1_visibility'

function svc() {
  return createUntypedServiceClient()
}

/**
 * Start a chunk. Updates build_progress.current_task + creates a build_chunks
 * row with status='in_progress'. Returns the chunk id which you'll pass to
 * markChunkDone.
 */
export async function markChunkStart(input: ChunkInput): Promise<string> {
  const sb = svc()
  const project_slug = input.project_slug ?? DEFAULT_PROJECT
  const phase = input.phase ?? DEFAULT_PHASE

  const ins = await sb
    .from('build_chunks')
    .insert({
      project_slug,
      phase,
      title: input.title,
      summary: input.summary ?? null,
      files_touched: input.files_touched ?? null,
      status: 'in_progress',
      typecheck_status: 'pending',
    })
    .select('id')
    .single()
  if (ins.error) {
    console.error('[build/progress] markChunkStart insert failed', ins.error)
    throw new Error(ins.error.message)
  }

  await sb
    .from('build_progress')
    .update({
      current_task: input.title,
      current_task_started_at: new Date().toISOString(),
      last_chunk_id: ins.data.id,
      updated_at: new Date().toISOString(),
    })
    .eq('project_slug', project_slug)
    .eq('phase', phase)

  return ins.data.id as string
}

/**
 * Complete a chunk. Updates the build_chunks row to status='done', recomputes
 * chunks_done_today on the progress row (atomic via record_build_chunk RPC),
 * and stores commit/preview/screenshot/loom links if provided.
 */
export async function markChunkDone(
  chunkId: string,
  completion: ChunkCompletion = {}
): Promise<void> {
  const sb = svc()
  const updates: Record<string, unknown> = {
    status: 'done',
    completed_at: new Date().toISOString(),
  }
  if (completion.summary !== undefined) updates.summary = completion.summary
  if (completion.commit_sha !== undefined) updates.commit_sha = completion.commit_sha
  if (completion.preview_url !== undefined) updates.preview_url = completion.preview_url
  if (completion.screenshot_urls !== undefined) updates.screenshot_urls = completion.screenshot_urls
  if (completion.loom_url !== undefined) updates.loom_url = completion.loom_url
  if (completion.typecheck_status !== undefined) updates.typecheck_status = completion.typecheck_status

  const upd = await sb.from('build_chunks').update(updates).eq('id', chunkId).select('project_slug, phase, completed_at').single()
  if (upd.error) {
    console.error('[build/progress] markChunkDone update failed', upd.error)
    return
  }

  // Recompute chunks_done_today using "today" anchored to 5am Europe/London (DA D7)
  const today5am = todayBoundary()
  const countQ = await sb
    .from('build_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('project_slug', upd.data.project_slug)
    .eq('phase', upd.data.phase)
    .eq('status', 'done')
    .gte('completed_at', today5am.toISOString())

  await sb
    .from('build_progress')
    .update({
      chunks_done_today: countQ.count ?? 0,
      last_screenshot_url:
        completion.screenshot_urls && completion.screenshot_urls.length > 0
          ? completion.screenshot_urls[0]
          : undefined,
      last_preview_url: completion.preview_url ?? undefined,
      last_commit_sha: completion.commit_sha ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('project_slug', upd.data.project_slug)
    .eq('phase', upd.data.phase)
}

/** Mark the build as blocked + reason. Triggers amber state on the page. */
export async function setBlocked(
  reason: string,
  opts: { project_slug?: string; phase?: string } = {}
): Promise<void> {
  const sb = svc()
  await sb
    .from('build_progress')
    .update({
      is_blocked: true,
      blocked_reason: reason,
      blocked_since: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('project_slug', opts.project_slug ?? DEFAULT_PROJECT)
    .eq('phase', opts.phase ?? DEFAULT_PHASE)
}

/** Clear blocked state. Call after the blocking issue is resolved. */
export async function clearBlocked(
  opts: { project_slug?: string; phase?: string } = {}
): Promise<void> {
  const sb = svc()
  await sb
    .from('build_progress')
    .update({
      is_blocked: false,
      blocked_reason: null,
      blocked_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq('project_slug', opts.project_slug ?? DEFAULT_PROJECT)
    .eq('phase', opts.phase ?? DEFAULT_PHASE)
}

/**
 * Mirror the agent's TodoWrite list to the progress row so /build/mobile
 * can render it verbatim under "Subtasks" (DA D13).
 */
export async function syncTodos(
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>,
  opts: { project_slug?: string; phase?: string } = {}
): Promise<void> {
  const sb = svc()
  await sb
    .from('build_progress')
    .update({
      todo_snapshot: todos,
      updated_at: new Date().toISOString(),
    })
    .eq('project_slug', opts.project_slug ?? DEFAULT_PROJECT)
    .eq('phase', opts.phase ?? DEFAULT_PHASE)
}

/** Read current state for a project+phase. Used by the page server-render. */
export async function getProgress(
  project_slug = DEFAULT_PROJECT,
  phase = DEFAULT_PHASE
) {
  const sb = svc()
  const [progress, recentChunks] = await Promise.all([
    sb
      .from('build_progress')
      .select('*')
      .eq('project_slug', project_slug)
      .eq('phase', phase)
      .maybeSingle(),
    sb
      .from('build_chunks')
      .select(
        'id, title, summary, status, typecheck_status, started_at, completed_at, commit_sha, preview_url, screenshot_urls'
      )
      .eq('project_slug', project_slug)
      .eq('phase', phase)
      .order('started_at', { ascending: false })
      .limit(15),
  ])
  return {
    progress: progress.data,
    recentChunks: recentChunks.data ?? [],
  }
}

/** Validate the URL token. Returns the project_slug it's bound to. */
export async function validateBuildToken(token: string): Promise<string | null> {
  const sb = svc()
  const { data } = await sb
    .from('build_tokens')
    .select('project_slug, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle()
  if (!data) return null
  if (data.revoked_at) return null
  if (new Date(data.expires_at as string) <= new Date()) return null
  return data.project_slug as string
}

// Today boundary: 5am Europe/London, the cutoff for "today's work"
function todayBoundary(): Date {
  const now = new Date()
  // Get current hour in Europe/London
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Europe/London',
  })
  const londonHour = parseInt(fmt.format(now), 10)
  // Get the date in Europe/London
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/London',
  })
  let londonDate = dateFmt.format(now)
  // If we're before 5am London, "today" is actually yesterday
  if (londonHour < 5) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - 1)
    londonDate = dateFmt.format(d)
  }
  // 05:00 in Europe/London on that date (BST or GMT auto)
  // Build the iso timestamp by hand — Europe/London = +0/+1 depending on date
  const dt = new Date(`${londonDate}T05:00:00`)
  return dt
}
