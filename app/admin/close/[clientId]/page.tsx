import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect, notFound } from 'next/navigation'
import TrialCloseCalculator, { type TrialCloseStats } from '@/components/admin/TrialCloseCalculator'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Trial Close · Nexley Admin' }

const MINS_PER_MESSAGE = 5
const MINS_PER_BOOKING = 30

export default async function TrialClosePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params

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

  // Fetch client row
  const { data: client } = await service
    .from('clients')
    .select('id, name, slug, subscription_status, trial_ends_at, created_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!client) notFound()

  // Trial window — trial_started_at doesn't exist; derive from trial_ends_at - 5 days
  // Fallback: created_at to created_at + 5 days
  const MS_5D = 5 * 24 * 60 * 60 * 1000
  let windowStart: Date
  let windowEnd: Date

  if (client.trial_ends_at) {
    windowEnd = new Date(client.trial_ends_at)
    windowStart = new Date(windowEnd.getTime() - MS_5D)
  } else if (client.created_at) {
    windowStart = new Date(client.created_at)
    windowEnd = new Date(Math.min(windowStart.getTime() + MS_5D, Date.now()))
  } else {
    windowEnd = new Date()
    windowStart = new Date(Date.now() - MS_5D)
  }

  // Parallel fetch — all queries are defensive: errors are tolerated and treated as 0
  // This prevents one broken query from crashing the whole page.
  const [msgsRes, bookingsRes, contactsRes, actionsRes, followUpsRes] = await Promise.allSettled([
    // Outbound messages the AI sent (every message = something the owner didn't have to type)
    service
      .from('comms_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('direction', 'outbound')
      .gte('sent_at', windowStart.toISOString())
      .lte('sent_at', windowEnd.toISOString()),

    // Bookings / opportunities created in trial window
    service
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', windowStart.toISOString())
      .lte('created_at', windowEnd.toISOString()),

    // New contacts (leads captured)
    service
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', windowStart.toISOString())
      .lte('created_at', windowEnd.toISOString()),

    // agent_actions — use minutes_saved directly if rows exist (often empty in practice)
    service
      .from('agent_actions')
      .select('category, minutes_saved')
      .eq('client_id', clientId)
      .gte('occurred_at', windowStart.toISOString())
      .lte('occurred_at', windowEnd.toISOString()),

    // Follow-ups — outbound messages tied to a sequence (automated follow-ups)
    service
      .from('comms_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('direction', 'outbound')
      .not('sequence_id', 'is', null)
      .gte('sent_at', windowStart.toISOString())
      .lte('sent_at', windowEnd.toISOString()),
  ])

  // Unwrap settled results defensively — any failed query becomes 0, page still renders
  const count = (r: PromiseSettledResult<{ count: number | null }>) =>
    r.status === 'fulfilled' ? (r.value.count ?? 0) : 0
  const rows = <T,>(r: PromiseSettledResult<{ data: T[] | null }>) =>
    r.status === 'fulfilled' ? (r.value.data ?? []) : []

  const messagesHandled = count(msgsRes)
  const bookingsMade = count(bookingsRes)
  const newContacts = count(contactsRes)
  const followUpsSent = count(followUpsRes)
  const actions = rows<{ category: string; minutes_saved: number | null }>(actionsRes)
  const actionsFromLog = actions.length
  const minutesSavedFromLog = actions.reduce((sum, r) => sum + (r.minutes_saved ?? 0), 0)

  // Time saved — concrete signals first, agent_actions supplement
  const minutesFromMessages = messagesHandled * MINS_PER_MESSAGE
  const minutesFromBookings = bookingsMade * MINS_PER_BOOKING
  const totalMinutesSaved = minutesFromMessages + minutesFromBookings + minutesSavedFromLog
  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10

  const hasActivity = messagesHandled > 0 || bookingsMade > 0 || newContacts > 0 || actionsFromLog > 0

  const stats: TrialCloseStats = {
    clientName: client.name || client.slug || 'Client',
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
  }

  return <TrialCloseCalculator stats={stats} />
}
