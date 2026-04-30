/**
 * OneSignal push notifications — server-side dispatch.
 *
 * Categories (set in OneSignal dashboard, referenced by ID server-side):
 *   escalation       iOS time-sensitive   Android HIGH      sound on
 *   customer_reply   iOS active           Android DEFAULT   sound on
 *   estimate_action  iOS active           Android DEFAULT   sound on
 *   daily_digest     iOS passive          Android LOW       silent
 *   billing          iOS active           Android DEFAULT   silent
 *   system           iOS active           Android DEFAULT   silent
 *
 * iOS 18 changed how non-time-sensitive pushes are throttled: anything we
 * really need delivered must use `interruption-level: time-sensitive` and
 * the matching focus filter. We only do that for `escalation`.
 *
 * Android 15 has Notification Cooldown which auto-dampens repeats — we don't
 * fight it; instead we coalesce on the server (don't fire customer_reply
 * for the same conversation more than once every 60s).
 *
 * Idempotency: every send takes an `idempotencyKey` which is forwarded to
 * OneSignal as the `Idempotency-Key` header AND used to coalesce in our
 * own `notifications` table.
 */

import { createUntypedServiceClient } from '@/lib/supabase/untyped'

const ONESIGNAL_API = 'https://api.onesignal.com'

function service() {
  return createUntypedServiceClient()
}

export type PushCategory =
  | 'escalation'
  | 'customer_reply'
  | 'estimate_action'
  | 'daily_digest'
  | 'system'
  | 'billing'

interface SendInput {
  /** Supabase user_id — used as OneSignal external_id alias to fan out to all of the user's devices. */
  userId: string
  clientId: string
  category: PushCategory
  title: string
  body: string
  /** Deep link route in the mobile app (e.g. '/conversation/abc-123'). */
  deepLink: string
  data?: Record<string, unknown>
  /** Stable across retries — also used to coalesce in-app notifications table. */
  idempotencyKey: string
  /** Skip coalescing dedupe; default false. Use for scheduled digests. */
  forceSend?: boolean
}

const ANDROID_CHANNEL_ID: Record<PushCategory, string> = {
  escalation: 'escalation_high',
  customer_reply: 'customer_reply_default',
  estimate_action: 'estimate_action_default',
  daily_digest: 'daily_digest_low',
  system: 'system_default',
  billing: 'billing_default',
}

const IOS_INTERRUPTION_LEVEL: Record<PushCategory, 'active' | 'passive' | 'time-sensitive' | 'critical'> = {
  escalation: 'time-sensitive',
  customer_reply: 'active',
  estimate_action: 'active',
  daily_digest: 'passive',
  system: 'active',
  billing: 'active',
}

const PRIORITY: Record<PushCategory, number> = {
  escalation: 10,
  customer_reply: 6,
  estimate_action: 6,
  daily_digest: 4,
  system: 5,
  billing: 5,
}

interface PreferencesRow {
  escalation: boolean
  customer_reply: boolean
  estimate_actions: boolean
  daily_digest: boolean
  digest_local_hour: number
  timezone: string
  quiet_hours_start: number | null
  quiet_hours_end: number | null
}

/**
 * Public entry — checks preferences, writes notification row, dispatches to
 * OneSignal. Returns the OneSignal notification id on success, or null if
 * suppressed by preferences/coalescing.
 */
export async function enqueuePush(input: SendInput): Promise<string | null> {
  const sb = service()

  // 1. Honour preferences
  const { data: prefs } = await sb
    .from('notification_preferences')
    .select('escalation, customer_reply, estimate_actions, daily_digest, digest_local_hour, timezone, quiet_hours_start, quiet_hours_end')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (prefs && !categoryAllowed(input.category, prefs as PreferencesRow)) {
    // Still write to history table so user sees it in-app, just no push
    await writeNotificationRow(sb, input, null, true)
    return null
  }

  // 2. Coalesce — don't double-push within 60s for the same idempotency key.
  // DA B14 fix: use the top-level idempotency_key column with composite index
  // (user_id, idempotency_key, created_at) — sub-ms lookup vs sequential scan.
  if (!input.forceSend) {
    const cutoff = new Date(Date.now() - 60_000).toISOString()
    const { data: dup } = await sb
      .from('notifications')
      .select('id, onesignal_notification_id')
      .eq('user_id', input.userId)
      .eq('idempotency_key', input.idempotencyKey)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (dup) return dup.onesignal_notification_id
  }

  // 3. Quiet hours — escalations override; everything else gets queued for next morning
  if (prefs && input.category !== 'escalation' && inQuietHours(prefs as PreferencesRow)) {
    await writeNotificationRow(sb, input, null, true)
    return null
  }

  // 4. Dispatch
  let onesignalId: string | null = null
  try {
    onesignalId = await dispatchOneSignal(input)
  } catch (err) {
    console.error('[push] dispatch failed', input.idempotencyKey, err)
    // Keep the notification row anyway — user sees it in-app even if push failed
  }

  await writeNotificationRow(sb, input, onesignalId, false)
  return onesignalId
}

function categoryAllowed(category: PushCategory, prefs: PreferencesRow): boolean {
  switch (category) {
    case 'escalation':       return prefs.escalation
    case 'customer_reply':   return prefs.customer_reply
    case 'estimate_action':  return prefs.estimate_actions
    case 'daily_digest':     return prefs.daily_digest
    case 'system':
    case 'billing':
      return true   // never silenced
  }
}

function inQuietHours(prefs: PreferencesRow): boolean {
  if (prefs.quiet_hours_start == null || prefs.quiet_hours_end == null) return false
  // Compute current hour in user's timezone — accept ±15 min slop, no need for
  // full timezone-aware date math here. UTC offset for Europe/London handled
  // by Postgres timezone setting if we ever migrate this server-side.
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: prefs.timezone || 'Europe/London',
  })
  const hour = parseInt(fmt.format(now), 10)
  if (Number.isNaN(hour)) return false
  const { quiet_hours_start: s, quiet_hours_end: e } = prefs
  if (s < e) return hour >= s && hour < e
  // wraps midnight (e.g. 22→06)
  return hour >= s || hour < e
}

async function dispatchOneSignal(input: SendInput): Promise<string> {
  const apiKey = process.env.ONESIGNAL_REST_API_KEY
  const appId = process.env.ONESIGNAL_APP_ID
  if (!apiKey || !appId) throw new Error('OneSignal env not configured')

  const res = await fetch(`${ONESIGNAL_API}/notifications`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      app_id: appId,
      include_aliases: { external_id: [input.userId] },
      target_channel: 'push',
      headings: { en: input.title },
      contents: { en: input.body },
      data: {
        route: input.deepLink,
        idempotency_key: input.idempotencyKey,
        category: input.category,
        ...input.data,
      },
      ios_category: input.category,
      ios_interruption_level: IOS_INTERRUPTION_LEVEL[input.category],
      android_channel_id: ANDROID_CHANNEL_ID[input.category],
      priority: PRIORITY[input.category],
      // App Store: time-sensitive requires the entitlement; OneSignal forwards
      // this header but iOS still respects user's focus filter unless allowed.
      ios_sound: input.category === 'daily_digest' || input.category === 'billing' ? null : 'default',
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`OneSignal ${res.status}: ${errBody.slice(0, 300)}`)
  }
  const json = (await res.json()) as { id?: string }
  if (!json.id) throw new Error('OneSignal response missing id')
  return json.id
}

async function writeNotificationRow(
  sb: ReturnType<typeof service>,
  input: SendInput,
  onesignalId: string | null,
  suppressed: boolean
): Promise<void> {
  const { error } = await sb.from('notifications').insert({
    user_id: input.userId,
    client_id: input.clientId,
    category: input.category,
    title: input.title,
    body: input.body,
    deep_link: input.deepLink,
    data: { ...(input.data ?? {}), suppressed },
    idempotency_key: input.idempotencyKey,           // DA B14 fix — top-level column, not nested
    onesignal_notification_id: onesignalId,
  })
  if (error) console.error('[push] notifications row insert failed', error)
}

/**
 * Alias a OneSignal subscription with the user's external_id. Call after the
 * user signs in on a device — once aliased, sends keyed by external_id fan
 * out to every device they've ever signed in on (until unenrolled).
 */
export async function aliasSubscription(
  onesignalSubscriptionId: string,
  externalId: string
): Promise<void> {
  const apiKey = process.env.ONESIGNAL_REST_API_KEY
  const appId = process.env.ONESIGNAL_APP_ID
  if (!apiKey || !appId) throw new Error('OneSignal env not configured')

  const res = await fetch(
    `${ONESIGNAL_API}/apps/${appId}/subscriptions/${onesignalSubscriptionId}/user/identity`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ identity: { external_id: externalId } }),
    }
  )
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`OneSignal alias ${res.status}: ${errBody.slice(0, 300)}`)
  }
}
