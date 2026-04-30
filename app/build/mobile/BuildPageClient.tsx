'use client'

/**
 * Client-side renderer for /build/mobile.
 *
 * Audit fix: dropped Supabase realtime subscription. Realtime requires
 * either (a) a `supabase_realtime` publication that includes our tables,
 * AND (b) RLS policies that allow the connecting JWT (anon) to SELECT —
 * neither is in place, so the realtime path silently failed. Polling
 * every 5 seconds via the existing token-gated `/api/build/recent-chunks`
 * + a new `/api/build/progress` endpoint is more reliable and works
 * without any extra Supabase config.
 */

import { useEffect, useState } from 'react'

interface ProgressRow {
  project_slug: string
  phase: string
  current_task: string | null
  current_task_started_at: string | null
  todo_snapshot: Array<{ content: string; status: string }> | null
  chunks_done_today: number
  total_chunks: number | null
  last_preview_url: string | null
  last_screenshot_url: string | null
  last_commit_sha: string | null
  last_commit_msg: string | null
  is_blocked: boolean
  blocked_reason: string | null
  blocked_since: string | null
  updated_at: string
}

interface ChunkRow {
  id: string
  title: string
  summary: string | null
  status: string
  typecheck_status: string | null
  started_at: string
  completed_at: string | null
  commit_sha: string | null
  preview_url: string | null
  screenshot_urls: string[] | null
}

interface Props {
  initialProgress: ProgressRow | null
  initialChunks: ChunkRow[]
  token: string
}

export function BuildPageClient({ initialProgress, initialChunks, token }: Props) {
  const [progress, setProgress] = useState(initialProgress)
  const [chunks, setChunks] = useState(initialChunks)

  // Poll every 5s when the page is visible. Pauses when the tab is in the
  // background (visibilitychange) so we don't burn battery on a phone in
  // someone's pocket.
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (!active) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        timer = setTimeout(tick, 10_000)
        return
      }
      try {
        const [pRes, cRes] = await Promise.all([
          fetch(`/api/build/progress?project=mobile&key=${encodeURIComponent(token)}`),
          fetch(`/api/build/recent-chunks?project=mobile`),
        ])
        if (pRes.ok) {
          const data = await pRes.json()
          if (active && data.progress) setProgress(data.progress as ProgressRow)
        }
        if (cRes.ok) {
          const data = await cRes.json()
          if (active && Array.isArray(data.items)) setChunks(data.items as ChunkRow[])
        }
      } catch {
        // Silent — next tick retries
      }
      timer = setTimeout(tick, 5_000)
    }
    timer = setTimeout(tick, 5_000)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [token])

  if (!progress) {
    return (
      <main className="min-h-screen bg-[#0a0a0b] text-white flex items-center justify-center px-6">
        <p className="text-sm text-white/60">No build in progress.</p>
      </main>
    )
  }

  const phaseLabel =
    progress.phase === 'phase1_visibility'
      ? 'Phase 1 · Visibility foundation'
      : progress.phase === 'phase2_capture'
        ? 'Phase 2 · Capture feature'
        : progress.phase

  const startedAgo = progress.current_task_started_at
    ? relativeTime(new Date(progress.current_task_started_at))
    : null

  const totalDone = progress.chunks_done_today
  const total = progress.total_chunks ?? null
  const pct = total && total > 0 ? Math.min(100, Math.round((totalDone / total) * 100)) : null

  return (
    <main
      className="min-h-screen text-white"
      style={{ background: progress.is_blocked ? '#2b1a0a' : '#0a0a0b' }}
    >
      {/* Pinned status header — always at top, always visible. The "pinned chat-bot" pattern
          implemented as a sticky page banner instead of a Telegram message. */}
      <header
        className="sticky top-0 z-10 px-6 pt-12 pb-5"
        style={{
          background: progress.is_blocked ? '#2b1a0a' : '#0a0a0b',
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        }}
      >
        <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45">
          Nexley Mobile · {phaseLabel}
        </p>
        <h1 className="mt-2 text-[24px] leading-[1.15] font-semibold tracking-tight text-white">
          {progress.is_blocked ? '⚠ Blocked' : progress.current_task ?? 'Idle'}
        </h1>
        {progress.is_blocked && progress.blocked_reason ? (
          <p className="mt-2 text-sm text-amber-200/80 leading-snug">{progress.blocked_reason}</p>
        ) : startedAgo ? (
          <p className="mt-1.5 text-[12px] text-white/40">started {startedAgo}</p>
        ) : null}
      </header>

      <div className="px-6 pb-24 pt-4 space-y-6 max-w-[640px] mx-auto">
        {/* TODAY counter */}
        <section>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45 mb-3">
            Today
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-mono tabular-nums text-[40px] tracking-[-0.04em] leading-none">
              {totalDone}
            </span>
            <span className="text-[14px] text-white/40">
              {total ? `/ ${total} chunks` : 'chunks'}
            </span>
          </div>
          {pct !== null && (
            <div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-white/80 transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </section>

        {/* Latest screenshot */}
        {progress.last_screenshot_url ? (
          <section>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45 mb-3">
              Latest screenshot
            </p>
            <a
              href={progress.last_preview_url ?? '/preview/mobile'}
              className="block rounded-lg overflow-hidden border border-white/8 bg-white/4"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={progress.last_screenshot_url}
                alt="Latest build screenshot"
                className="w-full h-auto block"
              />
            </a>
            <a
              href={progress.last_preview_url ?? '/preview/mobile'}
              className="mt-2 inline-block text-[13px] text-white/70 hover:text-white"
            >
              Open preview →
            </a>
          </section>
        ) : (
          <section>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45 mb-3">
              Preview
            </p>
            <a
              href="/preview/mobile"
              className="inline-block rounded-md border border-white/15 px-3 py-1.5 text-[13px] text-white/80 hover:bg-white/5"
            >
              Open prototype →
            </a>
          </section>
        )}

        {/* Subtasks (TodoWrite mirror) */}
        {progress.todo_snapshot && progress.todo_snapshot.length > 0 && (
          <section>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45 mb-3">
              Subtasks
            </p>
            <ul className="space-y-1.5">
              {progress.todo_snapshot.map((todo, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                  <span className="mt-[3px] shrink-0">
                    {todo.status === 'completed' ? (
                      <span className="text-emerald-400">✓</span>
                    ) : todo.status === 'in_progress' ? (
                      <span className="inline-block w-3 h-3 rounded-full border border-white/50 align-middle relative">
                        <span className="absolute inset-0 m-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      </span>
                    ) : (
                      <span className="text-white/30">○</span>
                    )}
                  </span>
                  <span
                    className={
                      todo.status === 'completed'
                        ? 'text-white/40 line-through decoration-white/20'
                        : todo.status === 'in_progress'
                          ? 'text-white'
                          : 'text-white/55'
                    }
                  >
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Recent chunks */}
        <section>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/45 mb-3">
            Recent chunks
          </p>
          {chunks.length === 0 ? (
            <p className="text-[13px] text-white/40">No chunks yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {chunks.map((c) => (
                <ChunkItem key={c.id} chunk={c} />
              ))}
            </ul>
          )}
        </section>

        {/* Footer */}
        <footer className="pt-8 pb-2 text-center">
          <p className="text-[10.5px] text-white/25 font-mono">
            updated {relativeTime(new Date(progress.updated_at))}
          </p>
        </footer>
      </div>
    </main>
  )
}

function ChunkItem({ chunk }: { chunk: ChunkRow }) {
  const ts = chunk.completed_at ?? chunk.started_at
  return (
    <li className="rounded-md border border-white/8 bg-white/2 p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-[1px] shrink-0">
          {chunk.status === 'done' ? (
            <span className="text-emerald-400">✓</span>
          ) : chunk.status === 'in_progress' ? (
            <span className="text-white/60">…</span>
          ) : chunk.status === 'reverted' ? (
            <span className="text-amber-300">↺</span>
          ) : (
            <span className="text-rose-300">⚠</span>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] leading-snug font-medium text-white/90 truncate">
            {chunk.title}
          </p>
          {chunk.summary && (
            <p className="mt-1 text-[12px] leading-snug text-white/55">{chunk.summary}</p>
          )}
          <p className="mt-1.5 flex items-center gap-2 text-[11px] text-white/35 font-mono">
            <span>{relativeTime(new Date(ts))}</span>
            {chunk.typecheck_status && (
              <>
                <span>·</span>
                <span
                  className={
                    chunk.typecheck_status === 'clean'
                      ? 'text-emerald-300/80'
                      : chunk.typecheck_status === 'failed'
                        ? 'text-rose-300/80'
                        : 'text-white/40'
                  }
                >
                  {chunk.typecheck_status === 'clean'
                    ? '✓ tsc'
                    : chunk.typecheck_status === 'failed'
                      ? '✗ tsc'
                      : 'tsc pending'}
                </span>
              </>
            )}
            {chunk.commit_sha && (
              <>
                <span>·</span>
                <span>{chunk.commit_sha.slice(0, 7)}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </li>
  )
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
