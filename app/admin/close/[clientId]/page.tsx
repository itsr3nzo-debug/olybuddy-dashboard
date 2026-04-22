import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect, notFound } from 'next/navigation'
import TrialCloseCalculator, { type TrialCloseStats, type ActivityItem } from '@/components/admin/TrialCloseCalculator'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Client Usage · Nexley Admin' }

const MINS_PER_MESSAGE = 5
const MINS_PER_BOOKING = 30

async function safeCount(promise: PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await promise).count ?? 0 } catch { return 0 }
}
async function safeRows<T>(promise: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try { return (await promise).data ?? [] } catch { return [] }
}

// Supabase returns FK joins as arrays (doesn't know if 1:1 or 1:many), so we
// type as array and pick [0] at the usage site.
type JoinedContact = { first_name: string | null; last_name: string | null }
type CommsRow = {
  id: string
  body: string | null
  sent_at: string
  channel: string | null
  contacts: JoinedContact[] | null
}
type OppRow = {
  id: string
  stage: string | null
  value_pence: number | null
  created_at: string
  contacts: JoinedContact[] | null
}
type ContactRow = {
  id: string
  first_name: string | null
  last_name: string | null
  created_at: string
}

function contactName(c: JoinedContact[] | null | undefined): string {
  const first = c?.[0]
  if (!first) return 'a customer'
  const name = [first.first_name, first.last_name].filter(Boolean).join(' ').trim()
  return name || 'a customer'
}

function snippet(body: string | null, max = 70): string {
  if (!body) return ''
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max).trim() + '…' : clean
}

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

  // Window: trial clients → actual trial window. Active/paid → last 5 days.
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

  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()

  // Counts + recent activity in parallel
  const [
    messagesHandled, bookingsMade, newContacts, followUpsSent,
    actionRows, recentMsgs, recentOpps, recentContacts,
  ] = await Promise.all([
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound')
      .gte('sent_at', startIso).lte('sent_at', endIso)),
    safeCount(service.from('opportunities').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('contacts').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).gte('created_at', startIso).lte('created_at', endIso)),
    safeCount(service.from('comms_log').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('direction', 'outbound').not('sequence_id', 'is', null)
      .gte('sent_at', startIso).lte('sent_at', endIso)),
    safeRows<{ category: string; minutes_saved: number | null }>(
      service.from('agent_actions').select('category, minutes_saved')
        .eq('client_id', clientId).gte('occurred_at', startIso).lte('occurred_at', endIso)
    ),
    safeRows<CommsRow>(
      service.from('comms_log')
        .select('id, body, sent_at, channel, contacts(first_name, last_name)')
        .eq('client_id', clientId).eq('direction', 'outbound')
        .gte('sent_at', startIso).lte('sent_at', endIso)
        .order('sent_at', { ascending: false }).limit(8)
    ),
    safeRows<OppRow>(
      service.from('opportunities')
        .select('id, stage, value_pence, created_at, contacts(first_name, last_name)')
        .eq('client_id', clientId)
        .gte('created_at', startIso).lte('created_at', endIso)
        .order('created_at', { ascending: false }).limit(5)
    ),
    safeRows<ContactRow>(
      service.from('contacts').select('id, first_name, last_name, created_at')
        .eq('client_id', clientId)
        .gte('created_at', startIso).lte('created_at', endIso)
        .order('created_at', { ascending: false }).limit(5)
    ),
  ])

  const actionsFromLog = actionRows.length
  const minutesSavedFromLog = actionRows.reduce((sum, r) => sum + (r.minutes_saved ?? 0), 0)
  const totalMinutesSaved =
    messagesHandled * MINS_PER_MESSAGE + bookingsMade * MINS_PER_BOOKING + minutesSavedFromLog
  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10
  const hasActivity =
    messagesHandled > 0 || bookingsMade > 0 || newContacts > 0 || actionsFromLog > 0

  // Build a unified activity timeline: messages + bookings + leads merged, newest first
  const timeline: ActivityItem[] = []

  for (const m of recentMsgs) {
    timeline.push({
      id: `msg-${m.id}`,
      kind: 'message',
      when: m.sent_at,
      channel: m.channel ?? 'whatsapp',
      title: `Replied to ${contactName(m.contacts)}`,
      preview: snippet(m.body),
    })
  }
  for (const o of recentOpps) {
    timeline.push({
      id: `opp-${o.id}`,
      kind: 'booking',
      when: o.created_at,
      title: `Booked opportunity with ${contactName(o.contacts ?? null)}`,
      preview: o.stage ? `Stage: ${o.stage}` : undefined,
      valuePence: o.value_pence,
    })
  }
  for (const c of recentContacts) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'a new contact'
    timeline.push({
      id: `ctc-${c.id}`,
      kind: 'lead',
      when: c.created_at,
      title: `Captured lead: ${name}`,
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
      bookingsMade,
      followUpsSent,
      newContacts,
      actionsFromLog,
      minutesSavedFromLog,
    },
    totalMinutesSaved,
    hoursSaved,
    hasActivity,
    timeline: timeline.slice(0, 12),
  }

  return <TrialCloseCalculator stats={stats} />
}
