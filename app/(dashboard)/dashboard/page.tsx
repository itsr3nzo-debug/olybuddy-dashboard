import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Overview | Olybuddy' }
import { redirect } from 'next/navigation'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import CallsChart, { ChartSkeleton } from '@/components/dashboard/CallsChart'
import DashboardRealtime from '@/components/dashboard/DashboardRealtime'
import EmptyState from '@/components/shared/EmptyState'
import HeroRoiCard from '@/components/dashboard/HeroRoiCard'
import AgentStatusCard from '@/components/dashboard/AgentStatusCard'
import WeeklyChallengeCard from '@/components/dashboard/WeeklyChallengeCard'
import type { CallLog, AgentStatus } from '@/lib/types'
import { Phone, Calendar, PoundSterling, XCircle } from 'lucide-react'
import { AI_PHONE_DISPLAY } from '@/lib/constants'

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

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const prevWeekStart = new Date(sevenDaysAgo)
  prevWeekStart.setDate(prevWeekStart.getDate() - 7)

  let calls: CallLog[] = []
  let prevCalls: CallLog[] = []
  let allTimeCalls = 0
  let bookingsThisWeek = 0
  let prevBookings = 0
  let agentName = 'Ava'
  let agentStatus: AgentStatus = 'online'
  let agentIsActive = true
  let agentLastCallAt: string | null = null

  if (clientId) {
    // Parallel fetch all dashboard data for faster load
    const [callsRes, prevRes, countRes, bookingsRes, prevBookingsRes, agentRes] = await Promise.all([
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
    ])

    calls = (callsRes.data ?? []) as CallLog[]
    prevCalls = (prevRes.data ?? []) as CallLog[]
    allTimeCalls = countRes.count ?? 0
    bookingsThisWeek = bookingsRes.count ?? 0
    prevBookings = prevBookingsRes.count ?? 0

    // Agent config (gracefully handle missing columns from migration)
    const ac = agentRes.data as Record<string, unknown> | null
    if (ac) {
      agentName = (ac.agent_name as string) ?? 'Ava'
      agentStatus = (ac.agent_status as AgentStatus) ?? 'online'
      agentIsActive = (ac.is_active as boolean) ?? true
      agentLastCallAt = (ac.last_call_at as string) ?? null
    }
  }

  const today = new Date().toDateString()
  const answered = calls.filter(c => c.status === 'completed').length
  const missed = calls.filter(c => c.status === 'no_answer' || c.status === 'failed').length
  const prevAnswered = prevCalls.filter((c: CallLog) => c.status === 'completed').length

  const savedPounds = answered * 15
  const prevSavedPounds = prevAnswered * 15

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
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-sm mt-1 text-muted-foreground">
            Last 7 days · {allTimeCalls} calls handled all time
          </p>
        </div>
        {streak > 0 && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium bg-card-bg ${streak >= 7 ? 'text-brand-success' : 'text-muted-foreground'}`}>
            🔥 {streak} day{streak === 1 ? '' : 's'} without a missed call
          </div>
        )}
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Setup required:</strong> Your account hasn&apos;t been linked to a business yet. Contact Olybuddy to complete your onboarding.
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
            label="Calls Handled"
            value={calls.length}
            sub={`${answered} answered`}
            color="accent"
            animate
            trend={trendPct(calls.length, prevCalls.length)}
            icon={<Phone size={16} />}
            sparklineData={callsSparkline}
          />
          <KpiCard
            label="Bookings Made"
            value={bookingsThisWeek}
            sub="from call → demo"
            color="default"
            animate
            trend={trendPct(bookingsThisWeek, prevBookings)}
            icon={<Calendar size={16} />}
          />
          <KpiCard
            label="Money Saved"
            value={savedPounds}
            prefix="£"
            sub="vs hiring a receptionist"
            color="success"
            animate
            trend={trendPct(savedPounds, prevSavedPounds)}
            icon={<PoundSterling size={16} />}
            sparklineData={savedSparkline}
          />
          <KpiCard
            label="Missed Calls"
            value={missed}
            sub={missed === 0 ? 'Perfect week!' : 'AI will follow up'}
            color={missed > 0 ? 'danger' : 'success'}
            animate
            icon={<XCircle size={16} />}
            sparklineData={missedSparkline}
          />
        </div>
      </Suspense>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Avg Call Duration" value={avgDurationStr(calls)} sub="completed calls only" />
        <KpiCard label="Inbound Calls" value={calls.filter(c => c.direction === 'inbound').length} sub="customers calling in" />
        <KpiCard label="Calls Today" value={calls.filter(c => c.started_at && new Date(c.started_at).toDateString() === today).length} sub="so far today" />
      </div>

      {/* Weekly Challenge */}
      <WeeklyChallengeCard lastWeekCalls={prevCalls.length} thisWeekCalls={calls.length} />

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
            title="No calls yet"
            description={`Your AI Employee is standing by. Call ${AI_PHONE_DISPLAY} to see your first call appear here.`}
          />
        ) : null}
      </Suspense>
    </div>
  )
}
