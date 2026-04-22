import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect, notFound } from 'next/navigation'
import TrialCloseCalculator, { type TrialCloseStats, type ActivityItem, type Period } from '@/components/admin/TrialCloseCalculator'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Client Usage · Nexley Admin' }

/* ── Time-saved estimates (minutes per action) ───────────────────── */
const MINS = {
  CHAT_MSG: 10, WHATSAPP_MSG: 10, CALL: 15,
  BOOKING: 45, LEAD: 10, ACTION: 5,
} as const

/* ── Defensive helpers ─────────────────────────────────────── */
async function safeCount(promise: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await promise).count ?? 0 } catch { return 0 }
}
async function safeRows<T>(promise: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try { return (await promise).data ?? [] } catch { return [] }
}

/* ── Row types (no customer PII — just aggregate shape of activity) ── */
type CommsRow = {
  id: string; sent_at: string; channel: string | null
}
type OppRow = {
  id: string; stage: string | null; value_pence: number | null; created_at: string
}
type ContactRow = {
  id: string; created_at: string
}
type ChatMsgRow = {
  id: string; created_at: string; session_id: string
}
type CallRow = {
  id: string; started_at: string | null; duration_seconds: number | null; status: string | null
}

/* ── Helpers ───────────────────────────────────────────────── */

/** UK-timezone-aware: is this timestamp outside Mon-Fri 9am-6pm? */
function isAfterHoursUK(iso: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      weekday: 'short',
      hour12: false,
    }).formatToParts(new Date(iso))
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '12')
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'
    const isWeekend = weekday === 'Sat' || weekday === 'Sun'
    const isOutsideHours = hour < 9 || hour >= 18
    return isWeekend || isOutsideHours
  } catch {
    return false
  }
}

function fmtResponseTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60 * 10) / 10
  return `${h}h`
}

/* ── Page ───────────────────────────────────────────────── */
export default async function ClientUsageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { clientId } = await params
  const { period: periodParam } = await searchParams

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const session = getUserSession(user)
  if (session.role !== 'super_admin') redirect('/dashboard')

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: client } = await service
    .from('clients')
    .select('id, name, slug, subscription_status, trial_ends_at, created_at')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) notFound()

  // ─── Window selection — driven by ?period= param ─────────────
  const isTrial =
    client.subscription_status === 'trial' || client.subscription_status === 'ai-employee-trial'

  // Parse period. Default: trial clients → 'trial', others → '30d'
  const period: Period = (periodParam === 'trial' || periodParam === '30d' || periodParam === 'all')
    ? (periodParam as Period)
    : (isTrial ? 'trial' : '30d')

  const now = Date.now()
  const MS_5D = 5 * 24 * 60 * 60 * 1000
  const MS_30D = 30 * 24 * 60 * 60 * 1000

  let windowStart: Date
  let windowEnd: Date

  if (period === 'trial') {
    // 5 days ending at trial_ends_at (or now if trial still running)
    if (client.trial_ends_at) {
      windowEnd = new Date(client.trial_ends_at)
      windowStart = new Date(windowEnd.getTime() - MS_5D)
    } else {
      windowEnd = new Date(now)
      windowStart = new Date(now - MS_5D)
    }
    // Clip future end to now
    if (windowEnd.getTime() > now) {
      windowEnd = new Date(now)
      windowStart = new Date(Math.max(windowStart.getTime(), now - MS_5D))
    }
  } else if (period === '30d') {
    windowEnd = new Date(now)
    windowStart = new Date(now - MS_30D)
  } else {
    // 'all' — since client joined
    windowEnd = new Date(now)
    windowStart = client.created_at ? new Date(client.created_at) : new Date(now - 365 * 24 * 60 * 60 * 1000)
  }

  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()

  // ─── Fetch everything in parallel ────────────────────────────
  const [
    chatMsgCount, chatSessionCount,
    whatsappMsgCount, whatsappFollowUpCount,
    bookingCount, newContactCount, callCount, actionCount,
    recentChatMsgs, recentComms, recentOpps, recentContacts, recentCalls,
    // Reliability: need user AND assistant chat messages (paired by session)
    // for real response time + coverage rate calculation
    allUserChatMsgs, allAssistantChatMsgs,
    // And all comms and calls for after-hours detection
    allCommsTimestamps, allCallTimestamps,
    // Non-follow-up WhatsApp count (real replies, not drip sequences)
    whatsappRealReplyCount,
  ] = await Promise.all([
    safeCount(service.from('agent_chat_messages').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('role', 'assistant')
      .gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('agent_chat_sessions').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound')
      .gte('sent_at', startIso).lte('sent_at', endIso)),
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound').not('sequence_id', 'is', null)
      .gte('sent_at', startIso).lte('sent_at', endIso)),
    safeCount(service.from('opportunities').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('contacts').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('call_logs').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('started_at', startIso).lte('started_at', endIso)),
    safeCount(service.from('agent_actions').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('occurred_at', startIso).lte('occurred_at', endIso)),
    safeRows<ChatMsgRow>(service.from('agent_chat_messages')
      .select('id, created_at, session_id')
      .eq('client_id', clientId).eq('role', 'assistant').eq('status', 'done')
      .gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(8)),
    safeRows<CommsRow>(service.from('comms_log')
      .select('id, sent_at, channel')
      .eq('client_id', clientId).eq('direction', 'outbound')
      .gte('sent_at', startIso).lte('sent_at', endIso)
      .order('sent_at', { ascending: false }).limit(6)),
    safeRows<OppRow>(service.from('opportunities')
      .select('id, stage, value_pence, created_at')
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(5)),
    safeRows<ContactRow>(service.from('contacts')
      .select('id, created_at')
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(5)),
    safeRows<CallRow>(service.from('call_logs')
      .select('id, started_at, duration_seconds, status')
      .eq('client_id', clientId).gte('started_at', startIso).lte('started_at', endIso)
      .order('started_at', { ascending: false }).limit(5)),

    // Reliability-specific: user + assistant messages paired for real response time
    safeRows<{ id: string; session_id: string; created_at: string }>(
      service.from('agent_chat_messages')
        .select('id, session_id, created_at')
        .eq('client_id', clientId).eq('role', 'user')
        .gte('created_at', startIso).lte('created_at', endIso)
        .order('created_at', { ascending: true }).limit(500)
    ),
    safeRows<{ session_id: string; created_at: string; status: string }>(
      service.from('agent_chat_messages')
        .select('session_id, created_at, status')
        .eq('client_id', clientId).eq('role', 'assistant')
        .gte('created_at', startIso).lte('created_at', endIso)
        .order('created_at', { ascending: true }).limit(500)
    ),
    safeRows<{ sent_at: string }>(
      service.from('comms_log')
        .select('sent_at')
        .eq('client_id', clientId).eq('direction', 'outbound')
        .gte('sent_at', startIso).lte('sent_at', endIso)
        .order('sent_at', { ascending: true }).limit(500)
    ),
    safeRows<{ started_at: string | null }>(
      service.from('call_logs')
        .select('started_at')
        .eq('client_id', clientId)
        .gte('started_at', startIso).lte('started_at', endIso)
        .order('started_at', { ascending: true }).limit(500)
    ),
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound').is('sequence_id', null)
      .gte('sent_at', startIso).lte('sent_at', endIso)),
  ])

  // ─── Time saved ──────────────────────────────────────────
  // Only count REAL replies (not automated follow-up sequences) for hours saved.
  // Drop agent_actions entirely — its relationship to user-facing events is unclear
  // and double-counting risk is too high for a pitch number.
  const totalMinutesSaved =
    chatMsgCount * MINS.CHAT_MSG +
    whatsappRealReplyCount * MINS.WHATSAPP_MSG +
    callCount * MINS.CALL +
    bookingCount * MINS.BOOKING +
    newContactCount * MINS.LEAD
  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10
  const messagesHandled = chatMsgCount + whatsappMsgCount
  const hasActivity =
    messagesHandled > 0 || bookingCount > 0 || newContactCount > 0 ||
    callCount > 0 || actionCount > 0

  // ─── Reliability metrics ─────────────────────────────────
  // After-hours: interactions outside UK Mon-Fri 9am-6pm
  const allTimestamps = [
    ...allUserChatMsgs.map(r => r.created_at),
    ...allAssistantChatMsgs.map(r => r.created_at),
    ...allCommsTimestamps.map(r => r.sent_at),
    ...allCallTimestamps.map(r => r.started_at).filter((t): t is string => Boolean(t)),
  ]
  const afterHoursCount = allTimestamps.filter(isAfterHoursUK).length
  const totalInteractions = allTimestamps.length
  const afterHoursPct = totalInteractions > 0
    ? Math.round((afterHoursCount / totalInteractions) * 100)
    : 0

  // REAL response time: pair each user msg with the first assistant reply in
  // the same session AFTER it. That's the time the customer actually waited.
  // (Previous code measured assistant streaming duration — wrong metric.)
  const responseTimes: number[] = []
  let coveredCount = 0
  let failedCount = 0

  for (const u of allUserChatMsgs) {
    const uTime = new Date(u.created_at).getTime()
    // Find first assistant message in the same session after this user message
    const reply = allAssistantChatMsgs.find(a =>
      a.session_id === u.session_id && new Date(a.created_at).getTime() > uTime
    )
    if (!reply) continue
    if (reply.status === 'error' || reply.status === 'failed') {
      failedCount++
      continue
    }
    if (reply.status === 'done') {
      coveredCount++
      const sec = (new Date(reply.created_at).getTime() - uTime) / 1000
      // Cap at 5 minutes — anything longer is an edge case (agent offline, etc.)
      if (sec >= 0 && sec <= 300) responseTimes.push(sec)
    }
  }

  const avgResponseSec = responseTimes.length >= 3
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null
  // Median is more honest than mean for response time (outliers skew mean)
  const sortedResponseTimes = [...responseTimes].sort((a, b) => a - b)
  const medianResponseSec = sortedResponseTimes.length >= 3
    ? sortedResponseTimes[Math.floor(sortedResponseTimes.length / 2)]
    : null

  // Coverage rate: computed from real data, not hardcoded
  const userMsgTotal = allUserChatMsgs.length
  const coveragePct = userMsgTotal > 0
    ? Math.round((coveredCount / userMsgTotal) * 100)
    : null  // null = "not enough data" — UI hides the row

  // ─── Timeline (privacy-preserving: no message bodies, no customer names) ──
  // The admin tool shows the SHAPE of activity (types, counts, timing) so
  // Kade can pitch. It doesn't surface message content or customer identities
  // — if Kade screen-shares during a close, the client doesn't see what feels
  // like surveillance of their own business.
  const timeline: ActivityItem[] = []
  for (const m of recentChatMsgs) {
    timeline.push({
      id: `chat-${m.id}`, kind: 'message', when: m.created_at,
      channel: 'chat', title: 'Replied to customer enquiry',
    })
  }
  for (const m of recentComms) {
    const ch = m.channel ?? 'whatsapp'
    timeline.push({
      id: `comm-${m.id}`, kind: 'message', when: m.sent_at,
      channel: ch, title: `Replied via ${ch}`,
    })
  }
  for (const o of recentOpps) {
    timeline.push({
      id: `opp-${o.id}`, kind: 'booking', when: o.created_at,
      title: 'Booked an opportunity',
      preview: o.stage ? `Stage: ${o.stage}` : undefined,
      valuePence: o.value_pence,
    })
  }
  for (const c of recentContacts) {
    timeline.push({
      id: `ctc-${c.id}`, kind: 'lead', when: c.created_at,
      title: 'Captured a new lead',
    })
  }
  for (const call of recentCalls) {
    if (!call.started_at) continue
    const dur = call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min call` : 'Call handled'
    timeline.push({
      id: `call-${call.id}`, kind: 'call', when: call.started_at,
      title: dur, preview: call.status ?? undefined,
    })
  }
  timeline.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())

  // Days in period (for honest ROI math — compare value to actual period cost)
  const daysInPeriod = Math.max(1, Math.round(
    (windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)
  ))

  const stats: TrialCloseStats = {
    clientName: client.name || client.slug || 'Client',
    clientId: client.id,
    subscriptionStatus: client.subscription_status ?? 'unknown',
    isTrial,
    period,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    trialEndsAt: client.trial_ends_at ?? null,
    activity: {
      messagesHandled,
      bookingsMade: bookingCount,
      followUpsSent: whatsappFollowUpCount,
      newContacts: newContactCount,
      actionsFromLog: actionCount,
      minutesSavedFromLog: 0,
      chatSessions: chatSessionCount,
      callsHandled: callCount,
    },
    reliability: {
      totalInteractions,
      afterHoursCount,
      afterHoursPct,
      medianResponseSec,
      medianResponseLabel: medianResponseSec !== null ? fmtResponseTime(medianResponseSec) : null,
      coveragePct,
      failedRepliesCount: failedCount,
      userMsgTotal,
    },
    daysInPeriod,
    totalMinutesSaved,
    hoursSaved,
    hasActivity,
    timeline: timeline.slice(0, 14),
  }

  return <TrialCloseCalculator stats={stats} />
}
