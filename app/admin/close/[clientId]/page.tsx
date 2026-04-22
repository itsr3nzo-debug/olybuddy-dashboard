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

/**
 * Safely run a Supabase count query. Returns 0 on any error (missing column,
 * RLS block, network failure) so a single broken query never crashes the page.
 */
async function safeCount(promise: PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const res = await promise
    return res.count ?? 0
  } catch {
    return 0
  }
}

async function safeRows<T>(promise: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const res = await promise
    return res.data ?? []
  } catch {
    return []
  }
}

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

  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()

  // Parallel fetch — each query wrapped in safeCount so one bad query can't crash the page
  const [messagesHandled, bookingsMade, newContacts, followUpsSent, actionRows] = await Promise.all([
    safeCount(
      service
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('direction', 'outbound')
        .gte('sent_at', startIso)
        .lte('sent_at', endIso)
    ),
    safeCount(
      service
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
    ),
    safeCount(
      service
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
    ),
    safeCount(
      service
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('direction', 'outbound')
        .not('sequence_id', 'is', null)
        .gte('sent_at', startIso)
        .lte('sent_at', endIso)
    ),
    safeRows<{ category: string; minutes_saved: number | null }>(
      service
        .from('agent_actions')
        .select('category, minutes_saved')
        .eq('client_id', clientId)
        .gte('occurred_at', startIso)
        .lte('occurred_at', endIso)
    ),
  ])

  const actionsFromLog = actionRows.length
  const minutesSavedFromLog = actionRows.reduce((sum, r) => sum + (r.minutes_saved ?? 0), 0)

  // Time saved
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
