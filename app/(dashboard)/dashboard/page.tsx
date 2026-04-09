import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import CallsChart, { ChartSkeleton } from '@/components/dashboard/CallsChart'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import type { CallLog } from '@/lib/types'
import { Phone, Calendar, PoundSterling, XCircle } from 'lucide-react'

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

function avgDurationStr(calls: CallLog[]): string {
  const durations = calls.filter(c => c.duration_seconds).map(c => c.duration_seconds!)
  if (!durations.length) return '—'
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  const m = Math.floor(avg / 60)
  const s = avg % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** Calculate streak of consecutive days without a missed call (up to today). */
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

  if (clientId) {
    // This week's calls
    const { data } = await supabase
      .from('call_logs')
      .select('*, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .gte('started_at', sevenDaysAgo.toISOString())
      .order('started_at', { ascending: false })
    calls = (data ?? []) as CallLog[]

    // Previous week's calls (for trend %)
    const { data: prev } = await supabase
      .from('call_logs')
      .select('id, status, started_at')
      .eq('client_id', clientId)
      .gte('started_at', prevWeekStart.toISOString())
      .lt('started_at', sevenDaysAgo.toISOString())
    prevCalls = (prev ?? []) as CallLog[]

    // All-time count
    const { count } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    allTimeCalls = count ?? 0

    // Bookings (opportunities stage = demo_booked this week)
    const { count: bc } = await supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('stage', 'demo_booked')
      .gte('created_at', sevenDaysAgo.toISOString())
    bookingsThisWeek = bc ?? 0

    const { count: pbc } = await supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('stage', 'demo_booked')
      .gte('created_at', prevWeekStart.toISOString())
      .lt('created_at', sevenDaysAgo.toISOString())
    prevBookings = pbc ?? 0
  }

  const today = new Date().toDateString()
  const answered = calls.filter(c => c.status === 'completed').length
  const missed = calls.filter(c => c.status === 'no_answer' || c.status === 'failed').length
  const prevAnswered = prevCalls.filter((c: CallLog) => c.status === 'completed').length

  // Money saved: each answered call = £15 equivalent (receptionist cost per call)
  const savedPounds = answered * 15
  const prevSavedPounds = prevAnswered * 15

  // Trend calculations (% change vs last week)
  function trendPct(curr: number, prev: number): number | undefined {
    if (prev === 0) return undefined
    return Math.round(((curr - prev) / prev) * 100)
  }

  const streak = calcMissedStreak([...calls, ...prevCalls])

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Overview</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Last 7 days · {allTimeCalls} calls handled all time
          </p>
        </div>
        {/* Streak pill */}
        {streak > 0 && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', color: streak >= 7 ? 'var(--success)' : 'var(--muted)' }}
          >
            🔥 {streak} day{streak === 1 ? '' : 's'} without a missed call
          </div>
        )}
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>Setup required:</strong> Your account hasn&apos;t been linked to a business yet. Contact Olybuddy to complete your onboarding.
          </p>
        </div>
      )}

      {/* KPI Grid */}
      <Suspense fallback={
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[0,1,2,3].map(i => <KpiCardSkeleton key={i} />)}
        </div>
      }>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Calls Handled"
            value={calls.length}
            sub={`${answered} answered`}
            color="accent"
            animate
            trend={trendPct(calls.length, prevCalls.length)}
            icon={<Phone size={16} />}
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
          />
          <KpiCard
            label="Missed Calls"
            value={missed}
            sub={missed === 0 ? 'Perfect week!' : 'AI will follow up'}
            color={missed > 0 ? 'danger' : 'success'}
            animate
            icon={<XCircle size={16} />}
          />
        </div>
      </Suspense>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Avg Call Duration"
          value={avgDurationStr(calls)}
          sub="completed calls only"
        />
        <KpiCard
          label="Inbound Calls"
          value={calls.filter(c => c.direction === 'inbound').length}
          sub="customers calling in"
        />
        <KpiCard
          label="Calls Today"
          value={calls.filter(c => c.started_at && new Date(c.started_at).toDateString() === today).length}
          sub="so far today"
        />
      </div>

      {/* Chart */}
      <Suspense fallback={<ChartSkeleton />}>
        <div className="mb-6">
          <CallsChart data={buildCallVolume(calls)} />
        </div>
      </Suspense>

      {/* Recent Calls */}
      <Suspense fallback={
        <div className="rounded-xl border p-5" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <div className="skeleton h-4 w-32 mb-4 rounded" />
          {[0,1,2,3,4].map(i => <div key={i} className="skeleton h-12 w-full rounded mb-2" />)}
        </div>
      }>
        <RecentCallsTable calls={calls.slice(0, 10)} />
      </Suspense>
    </div>
  )
}
