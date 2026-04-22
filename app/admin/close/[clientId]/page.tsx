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

/* ── Row types ───────────────────────────────────────────── */
type JoinedContact = { first_name: string | null; last_name: string | null }
type CommsRow = {
  id: string; body: string | null; sent_at: string; channel: string | null
  contacts: JoinedContact[] | null
}
type OppRow = {
  id: string; stage: string | null; value_pence: number | null; created_at: string
  contacts: JoinedContact[] | null
}
type ContactRow = {
  id: string; first_name: string | null; last_name: string | null; created_at: string
}
type ChatMsgRow = {
  id: string; content: string | null; created_at: string
  completed_at: string | null; session_id: string
}
type CallRow = {
  id: string; started_at: string | null; duration_seconds: number | null; status: string | null
}

/* ── Helpers ───────────────────────────────────────────────── */
function contactName(c: JoinedContact[] | null | undefined): string {
  const first = c?.[0]
  if (!first) return 'a customer'
  return [first.first_name, first.last_name].filter(Boolean).join(' ').trim() || 'a customer'
}
function snippet(body: string | null, max = 75): string {
  if (!body) return ''
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max).trim() + '…' : clean
}

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
    // Reliability-specific: fetch ALL chat message timestamps in the window
    allChatMsgTimestamps,
    // And all comms and calls for after-hours detection
    allCommsTimestamps, allCallTimestamps,
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
      .select('id, content, created_at, completed_at, session_id')
      .eq('client_id', clientId).eq('role', 'assistant').eq('status', 'done')
      .gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(8)),
    safeRows<CommsRow>(service.from('comms_log')
      .select('id, body, sent_at, channel, contacts(first_name, last_name)')
      .eq('client_id', clientId).eq('direction', 'outbound')
      .gte('sent_at', startIso).lte('sent_at', endIso)
      .order('sent_at', { ascending: false }).limit(6)),
    safeRows<OppRow>(service.from('opportunities')
      .select('id, stage, value_pence, created_at, contacts(first_name, last_name)')
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(5)),
    safeRows<ContactRow>(service.from('contacts')
      .select('id, first_name, last_name, created_at')
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)
      .order('created_at', { ascending: false }).limit(5)),
    safeRows<CallRow>(service.from('call_logs')
      .select('id, started_at, duration_seconds, status')
      .eq('client_id', clientId).gte('started_at', startIso).lte('started_at', endIso)
      .order('started_at', { ascending: false }).limit(5)),

    // Reliability-specific
    safeRows<{ created_at: string; completed_at: string | null }>(
      service.from('agent_chat_messages')
        .select('created_at, completed_at')
        .eq('client_id', clientId).eq('role', 'assistant').eq('status', 'done')
        .gte('created_at', startIso).lte('created_at', endIso)
        .limit(500)
    ),
    safeRows<{ sent_at: string }>(
      service.from('comms_log')
        .select('sent_at')
        .eq('client_id', clientId).eq('direction', 'outbound')
        .gte('sent_at', startIso).lte('sent_at', endIso)
        .limit(500)
    ),
    safeRows<{ started_at: string | null }>(
      service.from('call_logs')
        .select('started_at')
        .eq('client_id', clientId).gte('started_at', startIso).lte('started_at', endIso)
        .limit(500)
    ),
  ])

  // ─── Time saved ──────────────────────────────────────────
  const totalMinutesSaved =
    chatMsgCount * MINS.CHAT_MSG +
    whatsappMsgCount * MINS.WHATSAPP_MSG +
    callCount * MINS.CALL +
    bookingCount * MINS.BOOKING +
    newContactCount * MINS.LEAD +
    Math.max(0, actionCount - chatMsgCount - whatsappMsgCount) * MINS.ACTION
  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10
  const messagesHandled = chatMsgCount + whatsappMsgCount
  const hasActivity =
    messagesHandled > 0 || bookingCount > 0 || newContactCount > 0 ||
    callCount > 0 || actionCount > 0

  // ─── Reliability metrics ─────────────────────────────────
  // After-hours count: interactions outside Mon-Fri 9am-6pm UK time
  const allTimestamps = [
    ...allChatMsgTimestamps.map(r => r.created_at),
    ...allCommsTimestamps.map(r => r.sent_at),
    ...allCallTimestamps.map(r => r.started_at).filter((t): t is string => Boolean(t)),
  ]
  const afterHoursCount = allTimestamps.filter(isAfterHoursUK).length
  const totalInteractions = allTimestamps.length
  const afterHoursPct = totalInteractions > 0
    ? Math.round((afterHoursCount / totalInteractions) * 100)
    : 0

  // Avg response time from chat messages (only source with both timestamps)
  const responseTimes = allChatMsgTimestamps
    .filter(r => r.completed_at && r.created_at)
    .map(r => (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / 1000)
    .filter(s => s >= 0 && s < 3600) // Filter out bogus values (> 1h response means error)
  const avgResponseSec = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null

  // ─── Timeline ───────────────────────────────────────────
  const timeline: ActivityItem[] = []
  for (const m of recentChatMsgs) {
    timeline.push({
      id: `chat-${m.id}`, kind: 'message', when: m.created_at,
      channel: 'chat', title: 'Replied in dashboard chat',
      preview: snippet(m.content),
    })
  }
  for (const m of recentComms) {
    timeline.push({
      id: `comm-${m.id}`, kind: 'message', when: m.sent_at,
      channel: m.channel ?? 'whatsapp',
      title: `Replied to ${contactName(m.contacts ?? null)} via ${m.channel ?? 'WhatsApp'}`,
      preview: snippet(m.body),
    })
  }
  for (const o of recentOpps) {
    timeline.push({
      id: `opp-${o.id}`, kind: 'booking', when: o.created_at,
      title: `Booking with ${contactName(o.contacts ?? null)}`,
      preview: o.stage ? `Stage: ${o.stage}` : undefined,
      valuePence: o.value_pence,
    })
  }
  for (const c of recentContacts) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'new contact'
    timeline.push({
      id: `ctc-${c.id}`, kind: 'lead', when: c.created_at,
      title: `Captured lead: ${name}`,
    })
  }
  for (const call of recentCalls) {
    if (!call.started_at) continue
    const dur = call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min call` : 'Call'
    timeline.push({
      id: `call-${call.id}`, kind: 'call', when: call.started_at,
      title: dur, preview: call.status ?? undefined,
    })
  }
  timeline.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())

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
      avgResponseSec,
      avgResponseLabel: avgResponseSec !== null ? fmtResponseTime(avgResponseSec) : null,
    },
    totalMinutesSaved,
    hoursSaved,
    hasActivity,
    timeline: timeline.slice(0, 14),
  }

  return <TrialCloseCalculator stats={stats} />
}
