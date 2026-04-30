/**
 * GET /api/cron/send-daily-digest
 *
 * Sends each user a one-shot daily push: "Today: 12 messages handled · 3
 * bookings · 1 estimate awaiting your review."
 *
 * Schedule: every hour on the hour (vercel.json `0 * * * *`). The cron fires
 * 24× per UTC day and each tick selects users whose `digest_local_hour`
 * matches the current local hour (in their `timezone` from prefs).
 *
 * That's the cheap-but-correct way to do "fire at 5pm in user's timezone"
 * without a per-user scheduler. Daylight savings auto-handled by the
 * timezone formatter.
 */

import { authorizeCron } from '@/lib/cron/auth'
import { enqueuePush } from '@/lib/push/onesignal'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 300


export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = createUntypedServiceClient()

  // Pull users with daily_digest enabled. We'll filter by timezone-local-hour
  // in JS rather than SQL — Postgres lacks a clean per-row 'now in TZ X' fn.
  const { data: candidates } = await sb
    .from('notification_preferences')
    .select('user_id, digest_local_hour, timezone')
    .eq('daily_digest', true)

  if (!candidates || candidates.length === 0) {
    return Response.json({ ok: true, sent: 0 })
  }

  const today = new Date()
  let sent = 0
  let skipped = 0
  let failed = 0

  for (const pref of candidates) {
    const tz = (pref.timezone as string) || 'Europe/London'
    let localHour: number
    try {
      localHour = parseInt(
        new Intl.DateTimeFormat('en-GB', {
          hour: 'numeric',
          hour12: false,
          timeZone: tz,
        }).format(today),
        10
      )
    } catch {
      localHour = -1
    }
    if (localHour !== pref.digest_local_hour) {
      skipped += 1
      continue
    }

    try {
      // Need clientId for the push. Look up via auth.users → app_metadata.
      const { data: user } = await sb.auth.admin.getUserById(pref.user_id as string)
      const clientId = (user?.user?.app_metadata as { client_id?: string } | undefined)?.client_id
      if (!clientId) {
        skipped += 1
        continue
      }

      // Aggregate today's stats from agent_actions (the canonical ROI table).
      const startOfToday = new Date(today.getTime())
      startOfToday.setUTCHours(0, 0, 0, 0)
      const { data: actions } = await sb
        .from('agent_actions')
        .select('category')
        .eq('client_id', clientId)
        .gte('occurred_at', startOfToday.toISOString())

      const counts = { messages: 0, calls: 0, bookings: 0, estimates: 0 }
      for (const a of actions ?? []) {
        switch (a.category) {
          case 'message_handled': counts.messages += 1; break
          case 'call_taken': counts.calls += 1; break
          case 'booking_made': counts.bookings += 1; break
          case 'estimate_drafted': counts.estimates += 1; break
        }
      }
      // Skip empty days — no point pinging someone if there's nothing to report
      const total = counts.messages + counts.calls + counts.bookings + counts.estimates
      if (total === 0) {
        skipped += 1
        continue
      }

      const dateKey = startOfToday.toISOString().slice(0, 10)
      const idemKey = `digest:${pref.user_id}:${dateKey}`
      const body = formatDigestBody(counts)

      await enqueuePush({
        userId: pref.user_id as string,
        clientId,
        category: 'daily_digest',
        title: 'Your AI Employee today',
        body,
        deepLink: '/',
        idempotencyKey: idemKey,
        forceSend: true,           // bypass 60s coalesce — daily is once
      })
      sent += 1
    } catch (err) {
      console.error('[cron/digest] send failed:', err)
      failed += 1
    }
  }

  return Response.json({ ok: true, sent, skipped, failed })
}

function formatDigestBody(c: { messages: number; calls: number; bookings: number; estimates: number }) {
  const parts: string[] = []
  if (c.messages > 0) parts.push(`${c.messages} message${c.messages === 1 ? '' : 's'} handled`)
  if (c.calls > 0) parts.push(`${c.calls} call${c.calls === 1 ? '' : 's'} answered`)
  if (c.bookings > 0) parts.push(`${c.bookings} booking${c.bookings === 1 ? '' : 's'}`)
  if (c.estimates > 0) parts.push(`${c.estimates} estimate${c.estimates === 1 ? '' : 's'} drafted`)
  return parts.join(' · ')
}
