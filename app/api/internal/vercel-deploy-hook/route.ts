/**
 * POST /api/internal/vercel-deploy-hook
 *
 * Receives Vercel "deployment.succeeded" webhook events. On each successful
 * production deploy of the dashboard:
 *   1. Take a screenshot of /preview/mobile via microlink.io (free tier,
 *      no API key required)
 *   2. Upload the PNG to Supabase Storage `build-screenshots` bucket
 *   3. Update build_progress.last_screenshot_url + last_preview_url
 *
 * Auth: HMAC signature verification using VERCEL_WEBHOOK_SECRET. Configure
 * the secret on Vercel dashboard → Webhooks → Create webhook → set the
 * "Secret" field, then put the same value in VERCEL_WEBHOOK_SECRET env var.
 *
 * Vercel webhook docs:
 *   https://vercel.com/docs/integrations/webhooks-overview
 *   https://vercel.com/docs/integrations/webhooks-overview/webhooks-api#securing-webhooks
 *
 * If microlink fails / is rate-limited, the webhook still succeeds — we just
 * skip the screenshot and log. The build_progress page degrades gracefully
 * to a text-only "Open preview →" link.
 */

import crypto from 'node:crypto'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 60

const PROJECT_SLUG = 'mobile'
const SCREENSHOTS_BUCKET = 'build-screenshots'
const PREVIEW_PATH = '/preview/mobile'

interface VercelDeploymentEvent {
  type: string                                          // e.g. 'deployment.succeeded'
  payload: {
    deployment: {
      id: string
      url: string                                       // <project>-<hash>-<scope>.vercel.app
      meta?: { githubCommitSha?: string; githubCommitMessage?: string }
      target?: 'production' | 'preview' | 'staging'
    }
    project?: { name: string }
    team?: { id: string }
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function POST(request: Request) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET
  if (!secret) {
    // Safe failure mode: 200 with `skipped: true` so Vercel doesn't keep
    // retrying. Log loudly so on-call sees the missing config.
    console.warn('[vercel-deploy-hook] VERCEL_WEBHOOK_SECRET unset — skipping')
    return Response.json({ skipped: true, reason: 'secret_unset' })
  }

  // Read raw body for HMAC. Important: clone first since we'll JSON-parse later.
  const rawBody = await request.text()
  const presented = request.headers.get('x-vercel-signature') ?? ''
  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
  if (!timingSafeEqual(presented, expected)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let event: VercelDeploymentEvent
  try {
    event = JSON.parse(rawBody) as VercelDeploymentEvent
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  if (event.type !== 'deployment.succeeded') {
    return Response.json({ ok: true, ignored: event.type })
  }
  // Only act on production deploys; preview deploys are noisy
  if (event.payload.deployment.target && event.payload.deployment.target !== 'production') {
    return Response.json({ ok: true, ignored: 'preview_deploy' })
  }

  const deployUrl = event.payload.deployment.url
  const previewUrl = `https://${deployUrl}${PREVIEW_PATH}`
  const sb = createUntypedServiceClient()

  // 1. Take screenshot via microlink.io (free, no auth)
  // Wait a few seconds for the deploy to be reachable + JS to render
  let screenshotUrl: string | null = null
  try {
    const ms = new URL('https://api.microlink.io/')
    ms.searchParams.set('url', previewUrl)
    ms.searchParams.set('screenshot', 'true')
    ms.searchParams.set('viewport.width', '390')
    ms.searchParams.set('viewport.height', '844')
    ms.searchParams.set('viewport.deviceScaleFactor', '2')
    ms.searchParams.set('waitForTimeout', '3000')
    ms.searchParams.set('embed', 'screenshot.url')

    const msRes = await fetch(ms.toString())
    if (msRes.ok) {
      // microlink with embed=screenshot.url returns the PNG directly
      const bytes = new Uint8Array(await msRes.arrayBuffer())
      const fileName = `${PROJECT_SLUG}/${Date.now()}-${event.payload.deployment.id}.png`
      const upload = await sb.storage
        .from(SCREENSHOTS_BUCKET)
        .upload(fileName, bytes, { contentType: 'image/png', upsert: true })
      if (!upload.error) {
        const { data: signed } = await sb.storage
          .from(SCREENSHOTS_BUCKET)
          .createSignedUrl(fileName, 60 * 60 * 24 * 30) // 30-day signed URL
        screenshotUrl = signed?.signedUrl ?? null
      } else {
        console.error('[vercel-deploy-hook] storage upload failed:', upload.error)
      }
    } else {
      console.warn('[vercel-deploy-hook] microlink failed:', msRes.status)
    }
  } catch (err) {
    console.error('[vercel-deploy-hook] screenshot pipeline failed:', err)
    // Continue — we still want to update last_preview_url
  }

  // 2. Update build_progress with the latest deploy URL + screenshot
  const updates: Record<string, unknown> = {
    last_preview_url: previewUrl,
    last_commit_sha: event.payload.deployment.meta?.githubCommitSha ?? null,
    last_commit_msg: event.payload.deployment.meta?.githubCommitMessage ?? null,
    updated_at: new Date().toISOString(),
  }
  if (screenshotUrl) updates.last_screenshot_url = screenshotUrl

  const { error: progErr } = await sb
    .from('build_progress')
    .update(updates)
    .eq('project_slug', PROJECT_SLUG)
  if (progErr) {
    console.error('[vercel-deploy-hook] build_progress update failed:', progErr)
  }

  return Response.json({
    ok: true,
    deployment_id: event.payload.deployment.id,
    preview_url: previewUrl,
    screenshot: screenshotUrl ?? 'skipped',
  })
}
