/**
 * GET /api/cron/rotate-build-token
 *
 * Rotates the /build/{project} URL token weekly. DA fix D4 — if the token
 * leaks via screenshot/share-sheet/etc, it's exposed forever; weekly rotation
 * limits the blast radius.
 *
 * Behaviour:
 *   1. Generate a new 32-char URL-safe random token
 *   2. Insert into build_tokens with expires_at = +14 days (overlap window)
 *   3. Mark the previous active token as expires_at = +24h (grace period —
 *      anyone with the old link can keep using it for 24h while we hand out
 *      the new one)
 *   4. Notify the build watcher (env: BUILD_DIGEST_EMAIL) with the new URL
 *
 * Schedule: weekly on Monday 09:00 UK (vercel.json)
 */

import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 30

const PROJECT_SLUG = 'mobile'
const NEW_TOKEN_LIFETIME_DAYS = 14
const GRACE_HOURS = 24

export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = createUntypedServiceClient()

  // 1. Generate new token
  const newToken = crypto.randomBytes(24).toString('base64url')
  const newExpiresAt = new Date(Date.now() + NEW_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)

  const ins = await sb.from('build_tokens').insert({
    token: newToken,
    project_slug: PROJECT_SLUG,
    expires_at: newExpiresAt.toISOString(),
  })
  if (ins.error) {
    console.error('[cron/rotate-build-token] insert failed:', ins.error)
    return new Response('Insert failed', { status: 500 })
  }

  // 2. Shorten existing tokens (24h grace)
  const graceExpiresAt = new Date(Date.now() + GRACE_HOURS * 60 * 60 * 1000).toISOString()
  await sb
    .from('build_tokens')
    .update({ expires_at: graceExpiresAt })
    .eq('project_slug', PROJECT_SLUG)
    .neq('token', newToken)
    .is('revoked_at', null)
    .gt('expires_at', graceExpiresAt) // only shorten ones still further out

  // 3. Email the new URL
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexley.vercel.app'
  const newUrl = `${siteUrl}/build/${PROJECT_SLUG}?key=${newToken}`
  const recipient = process.env.BUILD_DIGEST_EMAIL
  let emailed = false
  if (recipient && process.env.SMTP_HOST) {
    try {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      })
      await transport.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER!,
        to: recipient,
        subject: 'Nexley build · new status link',
        text: `Your build progress URL has been rotated.\n\nNew link (valid 14 days):\n${newUrl}\n\nThe previous link will keep working for the next 24 hours.\n\nUpdate your phone home-screen bookmark.`,
        html: `<!DOCTYPE html><body style="font-family:-apple-system,sans-serif;padding:24px;">
          <h2 style="font-weight:600;color:#111827;">Build status link rotated</h2>
          <p>Your build progress URL has been rotated. The old link keeps working for 24 hours.</p>
          <p style="margin:24px 0;">
            <a href="${newUrl}" style="display:inline-block;padding:10px 18px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Open new build page →</a>
          </p>
          <p style="color:#6b7280;font-size:13px;">Update your phone home-screen bookmark to this URL. Valid for 14 days.</p>
          <p style="color:#9ca3af;font-size:11px;font-family:ui-monospace,monospace;margin-top:24px;word-break:break-all;">${newUrl}</p>
        </body>`,
      })
      emailed = true
    } catch (err) {
      console.error('[cron/rotate-build-token] email failed:', err)
    }
  }

  return Response.json({
    ok: true,
    new_token: newToken,           // Returned in response so on-call can grab it
    new_url: newUrl,
    emailed,
  })
}
