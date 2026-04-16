import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Overview | Nexley AI' }
import { redirect } from 'next/navigation'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import CallsChart, { ChartSkeleton } from '@/components/dashboard/CallsChart'
import DashboardRealtime from '@/components/dashboard/DashboardRealtime'
import EmptyState from '@/components/shared/EmptyState'
import HeroRoiCard from '@/components/dashboard/HeroRoiCard'
import AgentStatusCard from '@/components/dashboard/AgentStatusCard'
import IntegrationsCta from '@/components/dashboard/IntegrationsCta'
import VpsHeartbeatBadge from '@/components/dashboard/VpsHeartbeatBadge'
import WeeklyChallengeCard from '@/components/dashboard/WeeklyChallengeCard'
import OpportunityDonut from '@/components/dashboard/OpportunityDonut'
import type { CallLog, AgentStatus } from '@/lib/types'
import { Phone, Calendar, PoundSterling, XCircle } from 'lucide-react'
import { AI_PHONE_DISPLAY } from '@/lib/constants'
import { TimePeriodSelector } from '@/components/ui/time-period-selector'

/* ── Helpers ─────────────────────────────────────── */

function buildCallVolume(calls: CallLog[]): Array<{ date: string; calls: number }> {
  const counts: Record<string, number> = {}
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    counts[key] = 0
  }
  for (const call of calls) {
    if (!call.started_at) continue
    const key = new Date(call.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    if (key in counts) counts[key]++
  }
  return Object.entries(counts).map(([date, calls]) => ({ date, calls }))
}

function buildDailySparkline(calls: CallLog[], filterFn?: (c: CallLog) => boolean): number[] {
  const filtered = filterFn ? calls.filter(filterFn) : calls
  const counts: Record<string, number> = {}
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    counts[d.toDateString()] = 0
  }
  for (const call of filtered) {
    if (!call.started_at) continue
    const key = new Date(call.started_at).toDateString()
    if (key in counts) counts[key]++
  }
  return Object.values(counts)
}

function avgDurationStr(calls: CallLog[]): string {
  const durations = calls.filter(c => c.duration_seconds).map(c => c.duration_seconds!)
  if (!durations.length) return '—'
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  const m = Math.floor(avg / 60)
  const s = avg % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function calcMissedStreak(allCalls: CallLog[]): number {
  if (!allCalls.length) return 0
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 90; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toDateString()
    const hasMissed = allCalls.some(c =>
      c.started_at &&
      new Date(c.started_at).toDateString() === dateStr &&
      (c.status === 'no_answer' || c.status === 'failed')
    )
    if (hasMissed) break
    streak++
  }
  return streak
}

function trendPct(curr: number, prev: number): number | undefined {
  if (prev === 0) return undefined
  return Math.round(((curr - prev) / prev) * 100)
}

/* ── Page ────────────────────────────────────────── */

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  const params = await searchParams
  const periodKey = params.period || '7d'
  const periodDays = periodKey === '30d' ? 30 : periodKey === '90d' ? 90 : periodKey === 'all' ? 365 : 7
  const periodLabel = periodKey === '30d' ? 'Last 30 days' : periodKey === '90d' ? 'Last 90 days' : periodKey === 'all' ? 'All time' : 'Last 7 days'

  const periodStart = new Date()
  periodStart.setDate(periodStart.getDate() - periodDays)
  const prevPeriodStart = new Date(periodStart)
  prevPeriodStart.setDate(prevPeriodStart.getDate() - periodDays)

  // Legacy aliases for existing code
  const sevenDaysAgo = periodStart
  const prevWeekStart = prevPeriodStart

  let calls: CallLog[] = []
  let prevCalls: CallLog[] = []
  let allTimeCalls = 0
  let messagesThisPeriod = 0
  let prevMessages = 0
  let allTimeMessages = 0
  let newContacts = 0
  let followUpsSent = 0
  let bookingsThisWeek = 0
  let prevBookings = 0
  let agentName = 'Ava'
  let agentStatus: AgentStatus = 'online'
  let agentIsActive = true
  let agentLastCallAt: string | null = null
  let subscriptionPlan = 'trial'
  let oppOpen = 0
  let oppWon = 0
  let oppLost = 0
  let oppTotalValue = 0
  let integrationsCount = 0

  if (clientId) {
    // Parallel fetch all dashboard data for faster load
    const [callsRes, prevRes, countRes, bookingsRes, prevBookingsRes, agentRes, oppsRes, integrationsCountRes, clientRes, msgsRes, prevMsgsRes, allMsgsRes, newContactsRes, followUpsRes] = await Promise.all([
      supabase
        .from('call_logs')
        .select('*, contacts(first_name, last_name, phone)')
        .eq('client_id', clientId)
        .gte('started_at', sevenDaysAgo.toISOString())
        .order('started_at', { ascending: false }),
      supabase
        .from('call_logs')
        .select('id, status, started_at')
        .eq('client_id', clientId)
        .gte('started_at', prevWeekStart.toISOString())
        .lt('started_at', sevenDaysAgo.toISOString()),
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId),
      supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('stage', 'demo_booked')
        .gte('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('stage', 'demo_booked')
        .gte('created_at', prevWeekStart.toISOString())
        .lt('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('agent_config')
        .select('agent_name, agent_status, is_active, last_call_at')
        .eq('client_id', clientId)
        .single(),
      supabase
        .from('opportunities')
        .select('stage, value_pence')
        .eq('client_id', clientId),
      supabase
        .from('integrations')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'connected'),
      // Client subscription plan (for voice plan gating)
      supabase
        .from('clients')
        .select('subscription_plan')
        .eq('id', clientId)
        .single(),
      // WhatsApp/SMS messages this period
      supabase
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('sent_at', sevenDaysAgo.toISOString()),
      // Previous period messages
      supabase
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('sent_at', prevWeekStart.toISOString())
        .lt('sent_at', sevenDaysAgo.toISOString()),
      // All-time messages
      supabase
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId),
      // New contacts this period
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', sevenDaysAgo.toISOString()),
      // Follow-ups sent
      supabase
        .from('comms_log')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('direction', 'outbound')
        .gte('sent_at', sevenDaysAgo.toISOString()),
    ])

    calls = (callsRes.data ?? []) as CallLog[]
    prevCalls = (prevRes.data ?? []) as CallLog[]
    allTimeCalls = countRes.count ?? 0
    messagesThisPeriod = msgsRes.count ?? 0
    prevMessages = prevMsgsRes.count ?? 0
    allTimeMessages = allMsgsRes.count ?? 0
    newContacts = newContactsRes.count ?? 0
    followUpsSent = followUpsRes.count ?? 0
    bookingsThisWeek = bookingsRes.count ?? 0
    prevBookings = prevBookingsRes.count ?? 0
    subscriptionPlan = (clientRes.data as { subscription_plan: string } | null)?.subscription_plan ?? 'trial'

    // Agent config (gracefully handle missing columns from migration)
    const ac = agentRes.data as Record<string, unknown> | null
    if (ac) {
      agentName = (ac.agent_name as string) ?? 'Ava'
      agentStatus = (ac.agent_status as AgentStatus) ?? 'online'
      agentIsActive = (ac.is_active as boolean) ?? true
      agentLastCallAt = (ac.last_call_at as string) ?? null
    }

    integrationsCount = integrationsCountRes.count ?? 0

    // Opportunity pipeline data
    const opps = (oppsRes.data ?? []) as Array<{ stage: string; value_pence: number }>
    for (const o of opps) {
      oppTotalValue += o.value_pence ?? 0
      if (o.stage === 'won') oppWon++
      else if (o.stage === 'lost') oppLost++
      else oppOpen++
    }
  }

  const today = new Date().toDateString()
  const answered = calls.filter(c => c.status === 'completed').length
  const missed = calls.filter(c => c.status === 'no_answer' || c.status === 'failed').length
  const prevAnswered = prevCalls.filter((c: CallLog) => c.status === 'completed').length

  const totalConversations = messagesThisPeriod + calls.length
  const prevTotalConversations = prevMessages + prevCalls.length
  const isVoicePlan = subscriptionPlan === 'voice'

  // Money saved: messages × £5 + calls × £15 + bookings × £50
  const savedPounds = messagesThisPeriod * 5 + answered * 15 + bookingsThisWeek * 50
  const prevSavedPounds = prevMessages * 5 + prevAnswered * 15 + prevBookings * 50

  const streak = calcMissedStreak([...calls, ...prevCalls])

  // Sparkline data (7 daily values)
  const callsSparkline = buildDailySparkline(calls)
  const answeredSparkline = buildDailySparkline(calls, c => c.status === 'completed')
  const savedSparkline = answeredSparkline.map(v => v * 15)
  const missedSparkline = buildDailySparkline(calls, c => c.status === 'no_answer' || c.status === 'failed')

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            Overview <VpsHeartbeatBadge />
          </h1>
          <p className="text-sm mt-1 text-muted-foreground">
            {periodLabel} · {allTimeMessages + allTimeCalls} conversations all time
          </p>
        </div>
        <div className="flex items-center gap-3">
          {streak > 0 && (
            <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium bg-card-bg ${streak >= 7 ? 'text-brand-success' : 'text-muted-foreground'}`}>
              🔥 {streak}d streak
            </div>
          )}
          <Suspense fallback={null}>
            <TimePeriodSelector value={periodKey} />
          </Suspense>
        </div>
      </div>

      {clientId && integrationsCount === 0 && (
        <div className="mb-6">
          <IntegrationsCta />
        </div>
      )}

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Setup required:</strong> Your account hasn&apos;t been linked to a business yet. Contact Nexley AI to complete your onboarding.
          </p>
        </div>
      )}

      {/* AI Employee Status */}
      {clientId && (
        <AgentStatusCard
          agentName={agentName}
          status={agentStatus}
          lastCallAt={agentLastCallAt}
          isActive={agentIsActive}
          clientId={clientId}
        />
      )}

      {/* Hero ROI Card */}
      <HeroRoiCard savedPounds={savedPounds} />

      {/* KPI Grid */}
      <Suspense fallback={
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[0,1,2,3].map(i => <KpiCardSkeleton key={i} />)}
        </div>
      }>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Conversations"
            value={totalConversations}
            sub={`${messagesThisPeriod} messages · ${calls.length} calls`}
            color="accent"
            animate
            trend={trendPct(totalConversations, prevTotalConversations)}
            icon={<Phone size={16} />}
            sparklineData={callsSparkline}
          />
          <KpiCard
            label="Bookings Made"
            value={bookingsThisWeek}
            sub="appointments booked"
            color="default"
            animate
            trend={trendPct(bookingsThisWeek, prevBookings)}
            icon={<Calendar size={16} />}
          />
          <KpiCard
            label="Money Saved"
            value={savedPounds}
            prefix="£"
            sub="vs hiring an admin"
            color="success"
            animate
            trend={trendPct(savedPounds, prevSavedPounds)}
            icon={<PoundSterling size={16} />}
            sparklineData={savedSparkline}
          />
          <KpiCard
            label="Leads Captured"
            value={newContacts}
            sub="new contacts this period"
            color="accent"
            animate
            icon={<XCircle size={16} />}
          />
        </div>
      </Suspense>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Follow-ups Sent" value={followUpsSent} sub="automated chase messages" />
        <KpiCard label="Active Today" value={calls.filter(c => c.started_at && new Date(c.started_at).toDateString() === today).length + (messagesThisPeriod > 0 ? 1 : 0)} sub="conversations today" />
        <KpiCard label="Integrations" value={integrationsCount} sub="apps connected" />
      </div>

      {/* Voice Agent Section — only for £999/mo Voice plan */}
      {isVoicePlan && calls.length > 0 && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-400 mb-3">Voice Agent</h3>
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="Calls Handled" value={calls.length} sub={`${answered} answered`} color="accent" />
            <KpiCard label="Missed Calls" value={missed} sub={missed === 0 ? 'Perfect!' : 'AI will follow up'} color={missed > 0 ? 'danger' : 'success'} />
            <KpiCard label="Avg Duration" value={avgDurationStr(calls)} sub="completed calls only" />
          </div>
        </div>
      )}

      {/* Weekly Challenge */}
      <WeeklyChallengeCard lastWeekCalls={prevCalls.length} thisWeekCalls={calls.length} />

      {/* Pipeline Overview */}
      <OpportunityDonut openCount={oppOpen} wonCount={oppWon} lostCount={oppLost} totalValue={oppTotalValue} />

      {/* Chart */}
      <Suspense fallback={<ChartSkeleton />}>
        <div className="mb-6">
          <CallsChart data={buildCallVolume(calls)} />
        </div>
      </Suspense>

      {/* Recent Calls with Realtime */}
      <Suspense fallback={
        <div className="rounded-xl border p-5 bg-card-bg">
          <div className="skeleton h-4 w-32 mb-4 rounded" />
          {[0,1,2,3,4].map(i => <div key={i} className="skeleton h-12 w-full rounded mb-2" />)}
        </div>
      }>
        {calls.length > 0 ? (
          <DashboardRealtime initialCalls={calls.slice(0, 5)} clientId={clientId} />
        ) : clientId ? (
          <EmptyState
            icon={<Phone size={24} />}
            title="No activity yet"
            description="Your AI Employee is live on WhatsApp. Send a message to see conversations appear here."
          />
        ) : null}
      </Suspense>
    </div>
  )
}
