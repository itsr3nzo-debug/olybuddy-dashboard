import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect, notFound } from 'next/navigation'
import TrialCloseCalculator, { type TrialCloseStats, type ActivityItem } from '@/components/admin/TrialCloseCalculator'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Client Usage · Nexley Admin' }

/* ── Time-saved estimates (minutes per action) ─────────────────────────
 * Calibrated to what a trades/services business owner would actually spend
 * doing this themselves — including understanding the enquiry, typing a
 * proper response, finding a calendar slot, and doing the CRM admin. */
const MINS = {
  CHAT_MSG: 10,      // assistant reply in dashboard chat
  WHATSAPP_MSG: 10,  // outbound WhatsApp / SMS / email reply
  CALL: 15,          // phone call handled (incl. post-call admin)
  BOOKING: 45,       // opportunity created + confirmed + calendar slot
  LEAD: 10,          // contact captured + initial qualification
  ACTION: 5,         // generic agent_action row beyond msgs already counted
} as const

/* ── Defensive query helpers ─────────────────────────────────────── */
async function safeCount(promise: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await promise).count ?? 0 } catch { return 0 }
}
async function safeRows<T>(promise: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try { return (await promise).data ?? [] } catch { return [] }
}

/* ── Row types ─────────────────────────────────────────────────── */
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
  id: string; content: string | null; created_at: string; session_id: string
}
type CallRow = {
  id: string; started_at: string | null; duration_seconds: number | null; status: string | null
}

/* ── Helpers ─────────────────────────────────────────────────── */
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

/* ── Page ─────────────────────────────────────────────────── */
export default async function ClientUsageDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params

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

  // Window: trial clients get their trial window, everyone else gets last 5 days
  const MS_5D = 5 * 24 * 60 * 60 * 1000
  const isTrial =
    client.subscription_status === 'trial' || client.subscription_status === 'ai-employee-trial'

  let windowStart: Date
  let windowEnd: Date
  if (isTrial && client.trial_ends_at) {
    windowEnd = new Date(client.trial_ends_at)
    windowStart = new Date(windowEnd.getTime() - MS_5D)
  } else {
    windowEnd = new Date()
    windowStart = new Date(Date.now() - MS_5D)
  }

  // If the computed window is in the future (trial ends next week), use last 5 days instead
  // so we always show what the AI has actually done SO FAR.
  if (windowEnd.getTime() > Date.now()) {
    windowEnd = new Date()
    windowStart = new Date(Math.max(windowStart.getTime(), Date.now() - MS_5D))
  }

  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()

  // ─── Count everything in parallel (each safe) ──────────────────
  const [
    chatMsgCount, chatSessionCount,
    whatsappMsgCount, whatsappFollowUpCount,
    bookingCount, newContactCount, callCount, actionCount,
    recentChatMsgs, recentComms, recentOpps, recentContacts, recentCalls,
  ] = await Promise.all([
    // Dashboard chat — where trial clients actually test
    safeCount(service.from('agent_chat_messages').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('role', 'assistant')
      .gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('agent_chat_sessions').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),

    // WhatsApp / SMS / email via comms_log
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound')
      .gte('sent_at', startIso).lte('sent_at', endIso)),
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound').not('sequence_id', 'is', null)
      .gte('sent_at', startIso).lte('sent_at', endIso)),

    // Bookings / leads / calls / structured actions
    safeCount(service.from('opportunities').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('contacts').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('call_logs').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('started_at', startIso).lte('started_at', endIso)),
    safeCount(service.from('agent_actions').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('occurred_at', startIso).lte('occurred_at', endIso)),

    // Timeline items (what actually happened, ordered)
    safeRows<ChatMsgRow>(service.from('agent_chat_messages')
      .select('id, content, created_at, session_id')
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
  ])

  // ─── Calculate total time saved from real activity counts ──────
  // This gives a defensible number even when minutes_saved column is empty.
  const totalMinutesSaved =
    chatMsgCount * MINS.CHAT_MSG +
    whatsappMsgCount * MINS.WHATSAPP_MSG +
    callCount * MINS.CALL +
    bookingCount * MINS.BOOKING +
    newContactCount * MINS.LEAD +
    Math.max(0, actionCount - chatMsgCount - whatsappMsgCount) * MINS.ACTION
    // ^ avoid double-counting: only add agent_actions that aren't already
    // captured as chat/whatsapp messages
  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10

  // Total "messages handled" — chat + outbound comms (both are things the AI replied to)
  const messagesHandled = chatMsgCount + whatsappMsgCount

  const hasActivity =
    messagesHandled > 0 || bookingCount > 0 || newContactCount > 0 || callCount > 0 || actionCount > 0

  // ─── Build unified activity timeline ───────────────────────────
  const timeline: ActivityItem[] = []

  for (const m of recentChatMsgs) {
    timeline.push({
      id: `chat-${m.id}`,
      kind: 'message',
      when: m.created_at,
      channel: 'chat',
      title: 'Replied in dashboard chat',
      preview: snippet(m.content),
    })
  }
  for (const m of recentComms) {
    timeline.push({
      id: `comm-${m.id}`,
      kind: 'message',
      when: m.sent_at,
      channel: m.channel ?? 'whatsapp',
      title: `Replied to ${contactName(m.contacts ?? null)} via ${m.channel ?? 'WhatsApp'}`,
      preview: snippet(m.body),
    })
  }
  for (const o of recentOpps) {
    timeline.push({
      id: `opp-${o.id}`,
      kind: 'booking',
      when: o.created_at,
      title: `Booking with ${contactName(o.contacts ?? null)}`,
      preview: o.stage ? `Stage: ${o.stage}` : undefined,
      valuePence: o.value_pence,
    })
  }
  for (const c of recentContacts) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'new contact'
    timeline.push({
      id: `ctc-${c.id}`,
      kind: 'lead',
      when: c.created_at,
      title: `Captured lead: ${name}`,
    })
  }
  for (const call of recentCalls) {
    if (!call.started_at) continue
    const dur = call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min call` : 'Call'
    timeline.push({
      id: `call-${call.id}`,
      kind: 'call',
      when: call.started_at,
      title: dur,
      preview: call.status ?? undefined,
    })
  }
  timeline.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())

  const stats: TrialCloseStats = {
    clientName: client.name || client.slug || 'Client',
    subscriptionStatus: client.subscription_status ?? 'unknown',
    isTrial,
    trialStartedAt: windowStart.toISOString(),
    trialEndsAt: client.trial_ends_at ?? null,
    activity: {
      messagesHandled,
      bookingsMade: bookingCount,
      followUpsSent: whatsappFollowUpCount,
      newContacts: newContactCount,
      actionsFromLog: actionCount,
      minutesSavedFromLog: 0, // column is always 0 in practice
      chatSessions: chatSessionCount,
      callsHandled: callCount,
    },
    totalMinutesSaved,
    hoursSaved,
    hasActivity,
    timeline: timeline.slice(0, 14),
  }

  return <TrialCloseCalculator stats={stats} />
}
