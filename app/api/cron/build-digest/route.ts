/**
 * GET /api/cron/build-digest
 *
 * Daily digest of build progress, sent at 18:00 Europe/London. Pulls today's
 * chunks from build_chunks, renders an HTML email, sends to BUILD_DIGEST_EMAIL
 * via SMTP (env vars: SMTP_HOST, SMTP_USER, SMTP_PASS, optional SMTP_FROM).
 *
 * Schedule: hourly cron filtered to fire at 18:00 Europe/London (handles
 * BST/GMT automatically by checking the hour at run time).
 *
 * Falls back gracefully:
 *   - No SMTP config → logs + skips (page still has the data)
 *   - No BUILD_DIGEST_EMAIL → logs + skips
 *   - 0 chunks today → skips entirely (don't email "nothing happened today")
 */

import nodemailer from 'nodemailer'
import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 60

const PROJECT_SLUG = 'mobile'
const PHASE_LABEL: Record<string, string> = {
  phase1_visibility: 'Phase 1 · Visibility foundation',
  phase2_capture: 'Phase 2 · Capture feature',
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

export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  // Only fire at 18:00 Europe/London. The cron runs hourly so we self-gate.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Europe/London',
  })
  const londonHour = parseInt(fmt.format(new Date()), 10)
  if (londonHour !== 18) {
    return Response.json({ ok: true, skipped: 'not_18:00_london', hour: londonHour })
  }

  const sb = createUntypedServiceClient()

  // "Today" anchor = 5am Europe/London (matches the page counter)
  const today5am = startOfBuildDay()
  const { data: chunks, error: chunksErr } = await sb
    .from('build_chunks')
    .select(
      'id, title, summary, status, typecheck_status, started_at, completed_at, commit_sha, preview_url, screenshot_urls'
    )
    .eq('project_slug', PROJECT_SLUG)
    .gte('started_at', today5am.toISOString())
    .order('started_at', { ascending: true })

  if (chunksErr) {
    console.error('[cron/build-digest] chunks read failed:', chunksErr)
    return new Response('Read failed', { status: 500 })
  }

  if (!chunks || chunks.length === 0) {
    return Response.json({ ok: true, skipped: 'no_chunks_today' })
  }

  // Pull current progress for the header
  const { data: progress } = await sb
    .from('build_progress')
    .select('phase, current_task, last_preview_url, last_screenshot_url, is_blocked, blocked_reason')
    .eq('project_slug', PROJECT_SLUG)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const subject = digestSubject(chunks)
  const html = renderDigestHtml(chunks as ChunkRow[], progress)
  const text = renderDigestText(chunks as ChunkRow[], progress)

  // Try to send. If SMTP isn't configured, log loud and skip.
  const sent = await tryDispatchEmail({ subject, html, text })

  return Response.json({
    ok: true,
    chunks_count: chunks.length,
    sent,
    subject,
  })
}

function digestSubject(chunks: Array<{ status: string }>): string {
  const done = chunks.filter((c) => c.status === 'done').length
  const inProgress = chunks.filter((c) => c.status === 'in_progress').length
  const blocked = chunks.filter((c) => c.status === 'blocked').length
  const parts = [`${done} done`]
  if (inProgress > 0) parts.push(`${inProgress} in progress`)
  if (blocked > 0) parts.push(`${blocked} blocked`)
  return `Nexley Mobile build · ${parts.join(' · ')}`
}

function renderDigestText(
  chunks: ChunkRow[],
  progress: { phase?: string | null; current_task?: string | null } | null
): string {
  const lines: string[] = []
  if (progress?.phase) lines.push(PHASE_LABEL[progress.phase] ?? progress.phase)
  if (progress?.current_task) lines.push(`Currently: ${progress.current_task}`)
  lines.push('')
  for (const c of chunks) {
    const tick = c.status === 'done' ? '✓' : c.status === 'in_progress' ? '…' : '⚠'
    lines.push(`${tick} ${c.title}`)
    if (c.summary) lines.push(`   ${c.summary}`)
  }
  return lines.join('\n')
}

function renderDigestHtml(
  chunks: ChunkRow[],
  progress: {
    phase?: string | null
    current_task?: string | null
    last_preview_url?: string | null
    last_screenshot_url?: string | null
    is_blocked?: boolean | null
    blocked_reason?: string | null
  } | null
): string {
  const phaseLabel = progress?.phase ? PHASE_LABEL[progress.phase] ?? progress.phase : 'Nexley Mobile'

  const chunkRows = chunks
    .map((c) => {
      const tick =
        c.status === 'done'
          ? '<span style="color:#10b981">✓</span>'
          : c.status === 'in_progress'
            ? '<span style="color:#9ca3af">…</span>'
            : '<span style="color:#f59e0b">⚠</span>'
      const tsc = c.typecheck_status
        ? c.typecheck_status === 'clean'
          ? ' · <span style="color:#10b981">tsc ✓</span>'
          : c.typecheck_status === 'failed'
            ? ' · <span style="color:#ef4444">tsc ✗</span>'
            : ''
        : ''
      const summary = c.summary
        ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${escapeHtml(c.summary)}</div>`
        : ''
      return `
        <tr><td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:14px;font-weight:500;color:#111827;">${tick} ${escapeHtml(c.title)}</div>
          ${summary}
          <div style="color:#9ca3af;font-size:11px;margin-top:6px;font-family:ui-monospace,monospace;">
            ${formatTime(c.completed_at ?? c.started_at)}${tsc}${c.commit_sha ? ` · ${c.commit_sha.slice(0, 7)}` : ''}
          </div>
        </td></tr>`
    })
    .join('')

  const blockedBanner = progress?.is_blocked
    ? `<div style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:6px;margin:16px 0;">
         <div style="font-weight:600;color:#92400e;">⚠ Build is blocked</div>
         <div style="color:#92400e;margin-top:4px;font-size:13px;">${escapeHtml(progress.blocked_reason ?? '')}</div>
       </div>`
    : ''

  const screenshotImg = progress?.last_screenshot_url
    ? `<div style="margin:24px 0;text-align:center;">
         <a href="${progress.last_preview_url ?? '#'}" style="display:inline-block;">
           <img src="${progress.last_screenshot_url}" alt="Latest preview"
                style="max-width:280px;border:1px solid #e5e7eb;border-radius:8px;" />
         </a>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html><body style="margin:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;">
    <tr><td style="padding:32px 28px 8px;">
      <div style="font-size:11px;color:#6b7280;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(phaseLabel)}</div>
      <h1 style="margin:8px 0 0;font-size:22px;color:#111827;font-weight:600;letter-spacing:-0.02em;">
        Today's build · ${chunks.filter((c) => c.status === 'done').length} chunks done
      </h1>
      ${progress?.current_task ? `<div style="margin-top:6px;color:#6b7280;font-size:13px;">Currently: ${escapeHtml(progress.current_task)}</div>` : ''}
      ${blockedBanner}
      ${screenshotImg}
    </td></tr>
    <tr><td style="padding:0 28px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${chunkRows}
      </table>
      <div style="margin-top:24px;text-align:center;">
        <a href="${progress?.last_preview_url ?? 'https://nexley.vercel.app/preview/mobile'}"
           style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">
          Open preview →
        </a>
      </div>
    </td></tr>
    <tr><td style="padding:16px 28px 28px;text-align:center;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:11px;font-family:ui-monospace,monospace;">
      Nexley Mobile build digest
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}

function startOfBuildDay(): Date {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Europe/London',
  })
  const londonHour = parseInt(fmt.format(now), 10)
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/London',
  })
  let londonDate = dateFmt.format(now)
  if (londonHour < 5) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - 1)
    londonDate = dateFmt.format(d)
  }
  return new Date(`${londonDate}T05:00:00`)
}

async function tryDispatchEmail(input: {
  subject: string
  html: string
  text: string
}): Promise<boolean> {
  const to = process.env.BUILD_DIGEST_EMAIL
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!to) {
    console.warn('[cron/build-digest] BUILD_DIGEST_EMAIL unset — skipping send')
    return false
  }
  if (!host || !user || !pass) {
    console.warn('[cron/build-digest] SMTP_HOST/USER/PASS unset — skipping send')
    return false
  }

  try {
    const transport = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: { user, pass },
    })
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? user,
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })
    return true
  } catch (err) {
    console.error('[cron/build-digest] send failed:', err)
    return false
  }
}
