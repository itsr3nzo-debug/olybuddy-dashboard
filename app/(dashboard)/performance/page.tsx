import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Performance | Nexley AI' }
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import type { CallLog } from '@/lib/types'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import { Phone, Clock, CheckCircle, Zap } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import SentimentDonut from '@/components/performance/SentimentDonut'
import PeakHoursHeatmap from '@/components/performance/PeakHoursHeatmap'
import BeforeAfterCard from '@/components/performance/BeforeAfterCard'
import BenchmarkCard from '@/components/performance/BenchmarkCard'
import FunnelChart from '@/components/pipeline/FunnelChart'
import { TimePeriodSelector } from '@/components/ui/time-period-selector'

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const periodKey = params.period || '30d'
  const periodDays = periodKey === '7d' ? 7 : periodKey === '90d' ? 90 : periodKey === 'all' ? 365 : 30
  const periodLabel = periodKey === '7d' ? 'Last 7 days' : periodKey === '90d' ? 'Last 90 days' : periodKey === 'all' ? 'All time' : 'Last 30 days'

  const clientId = user.app_metadata?.client_id
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let calls: CallLog[] = []
  let agentName = 'Your AI Employee'
  let clientIndustry: string | null = null
  let clientCreatedAt: string | null = null
  let first30Calls: CallLog[] = []
  let bookingsThisMonth = 0
  let funnelData: Array<{ stage: string; count: number; value: number }> = []

  if (clientId) {
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - periodDays)

    const [callsRes, configRes, clientRes, bookingsRes, allOppsRes] = await Promise.all([
      supabase
        .from('call_logs')
        .select('status, duration_seconds, direction, started_at, ended_at, sentiment, analysis, summary')
        .eq('client_id', clientId)
        .gte('started_at', thirtyDaysAgo.toISOString()),
      supabase
        .from('agent_config')
        .select('business_name, agent_name')
        .eq('client_id', clientId)
        .single(),
      supabase
        .from('clients')
        .select('industry, created_at')
        .eq('id', clientId)
        .single(),
      supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('stage', 'demo_booked')
        .gte('created_at', monthStart.toISOString()),
      supabase
        .from('opportunities')
        .select('stage, value_pence')
        .eq('client_id', clientId),
    ])

    calls = (callsRes.data ?? []) as CallLog[]
    const config = configRes.data as Record<string, string> | null
    agentName = config?.agent_name ?? config?.business_name ?? 'Your AI Employee'
    clientIndustry = clientRes.data?.industry ?? null
    clientCreatedAt = clientRes.data?.created_at ?? null
    bookingsThisMonth = bookingsRes.count ?? 0

    // Funnel data from all opportunities
    const allOpps = (allOppsRes.data ?? []) as Array<{ stage: string; value_pence: number }>
    const funnelMap: Record<string, { count: number; value: number }> = {}
    for (const o of allOpps) {
      if (!funnelMap[o.stage]) funnelMap[o.stage] = { count: 0, value: 0 }
      funnelMap[o.stage].count++
      funnelMap[o.stage].value += o.value_pence ?? 0
    }
    funnelData = Object.entries(funnelMap).map(([stage, d]) => ({ stage, count: d.count, value: d.value }))

    // First 30 days of calls (for before/after comparison)
    if (clientCreatedAt) {
      const first30End = new Date(clientCreatedAt)
      first30End.setDate(first30End.getDate() + 30)
      const { data: f30 } = await supabase
        .from('call_logs')
        .select('status, duration_seconds, sentiment')
        .eq('client_id', clientId)
        .gte('started_at', clientCreatedAt)
        .lt('started_at', first30End.toISOString())
      first30Calls = (f30 ?? []) as CallLog[]
    }
  }

  const totalCalls = calls.length
  const answeredCalls = calls.filter(c => c.status === 'completed').length
  const resolutionRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0
  const daysThisMonth = now.getDate()
  const hoursWorked = daysThisMonth * 24

  const durations = calls.filter(c => c.duration_seconds && c.status === 'completed').map(c => c.duration_seconds!)
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  // Sentiment
  const posCount = calls.filter(c => c.sentiment === 'positive').length
  const neuCount = calls.filter(c => c.sentiment === 'neutral' || !c.sentiment).length
  const negCount = calls.filter(c => c.sentiment === 'negative').length

  // Peak hours data (7x24 grid)
  const peakData: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const call of calls) {
    if (!call.started_at) continue
    const d = new Date(call.started_at)
    const day = d.getDay() // 0=Sun
    const hour = d.getHours()
    peakData[day][hour]++
  }

  // Before/after comparison
  const computePeriod = (periodCalls: CallLog[]) => {
    const total = periodCalls.length
    const answered = periodCalls.filter(c => c.status === 'completed').length
    const durs = periodCalls.filter(c => c.duration_seconds && c.status === 'completed').map(c => c.duration_seconds!)
    const avgDur = durs.length > 0 ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0
    const pos = periodCalls.filter(c => c.sentiment === 'positive').length
    return {
      resolutionRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      callsHandled: total,
      positiveRate: total > 0 ? Math.round((pos / total) * 100) : 0,
      avgDuration: avgDur,
    }
  }
  const first30Stats = computePeriod(first30Calls)
  const current30Stats = computePeriod(calls)
  const daysSinceStart = clientCreatedAt ? Math.ceil((now.getTime() - new Date(clientCreatedAt).getTime()) / (1000 * 60 * 60 * 24)) : 0

  // Benchmarks
  const answerRate = resolutionRate
  const bookingRate = totalCalls > 0 ? Math.round((bookingsThisMonth / totalCalls) * 100) : 0

  // Top call reasons from analysis
  const reasons: Record<string, number> = {}
  for (const call of calls) {
    const reason = (call.analysis as Record<string, string>)?.intent
      || (call.analysis as Record<string, string>)?.reason
      || (call.summary ? call.summary.split('.')[0].slice(0, 40) : null)
    if (reason) reasons[reason] = (reasons[reason] || 0) + 1
  }
  const topReasons = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Performance</h1>
          <p className="text-sm mt-1 text-muted-foreground">
            {agentName} · {periodLabel}
          </p>
        </div>
        <Suspense fallback={null}>
          <TimePeriodSelector value={periodKey} options={[
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
          ]} />
        </Suspense>
      </div>

      {/* AI Employee framing */}
      <div className="rounded-xl border p-6 mb-6 bg-card-bg">
        <p className="text-xs font-medium uppercase tracking-wider mb-2 text-muted-foreground">This month</p>
        <p className="text-xl sm:text-2xl font-bold text-foreground">
          {agentName} worked <span className="text-brand-primary">{hoursWorked} hours</span>,
          handled <span className="text-brand-success">{totalCalls} calls</span>,
          and never took a day off.
        </p>
      </div>

      {/* Stats grid */}
      <Suspense fallback={
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {[0,1,2,3].map(i => <KpiCardSkeleton key={i} />)}
        </div>
      }>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Conversations" value={totalCalls} sub="this period" color="accent" animate icon={<Phone size={16} />} />
          <KpiCard label="Resolution Rate" value={`${resolutionRate}%`} sub="conversations resolved" color="success" icon={<CheckCircle size={16} />} />
          <KpiCard label="Avg Duration" value={formatDuration(avgDuration)} sub="completed calls" icon={<Clock size={16} />} />
          <KpiCard label="Hours Worked" value={hoursWorked} sub="24/7 this month" color="warning" animate icon={<Zap size={16} />} />
        </div>
      </Suspense>

      {/* Pipeline Funnel */}
      {funnelData.length > 0 && (
        <div className="rounded-xl border p-6 bg-card-bg mb-6">
          <h2 className="text-sm font-semibold mb-4 text-foreground">Pipeline Funnel</h2>
          <FunnelChart stageData={funnelData} />
        </div>
      )}

      {/* Before/After + Benchmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <BeforeAfterCard
          first30={first30Stats}
          current30={current30Stats}
          hasEnoughData={daysSinceStart >= 60}
        />
        <BenchmarkCard
          answerRate={answerRate}
          avgDuration={avgDuration}
          bookingRate={bookingRate}
          industry={clientIndustry}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Sentiment donut */}
        <div className="rounded-xl border p-6 bg-card-bg">
          <h2 className="text-sm font-semibold mb-4 text-foreground">Caller Sentiment</h2>
          <SentimentDonut positive={posCount} neutral={neuCount} negative={negCount} />
        </div>

        {/* Top call reasons */}
        <div className="rounded-xl border p-6 bg-card-bg">
          <h2 className="text-sm font-semibold mb-4 text-foreground">Top Call Reasons</h2>
          {topReasons.length > 0 ? (
            <div className="space-y-3">
              {topReasons.map(([reason, count], i) => {
                const maxCount = topReasons[0][1]
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={i}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-foreground truncate max-w-[70%]">{reason}</span>
                      <span className="text-sm text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-brand-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Conversation topics will appear as more messages are handled.</p>
          )}
        </div>
      </div>

      {/* Peak hours heatmap */}
      <div className="rounded-xl border p-6 bg-card-bg">
        <h2 className="text-sm font-semibold mb-4 text-foreground">Peak Hours</h2>
        <PeakHoursHeatmap data={peakData} />
      </div>
    </div>
  )
}
