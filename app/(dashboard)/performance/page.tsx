import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Performance | Olybuddy' }
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import type { CallLog } from '@/lib/types'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import { Phone, Clock, CheckCircle, Zap } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import SentimentDonut from '@/components/performance/SentimentDonut'
import PeakHoursHeatmap from '@/components/performance/PeakHoursHeatmap'

export default async function PerformancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let calls: CallLog[] = []
  let businessName = 'Your AI Employee'

  if (clientId) {
    const { data } = await supabase
      .from('call_logs')
      .select('status, duration_seconds, direction, started_at, ended_at, sentiment')
      .eq('client_id', clientId)
      .gte('started_at', monthStart.toISOString())
    calls = (data ?? []) as CallLog[]

    const { data: config } = await supabase
      .from('agent_config')
      .select('business_name')
      .eq('client_id', clientId)
      .single()
    if (config?.business_name) businessName = config.business_name
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Performance</h1>
        <p className="text-sm mt-1 text-muted-foreground">
          {businessName}&apos;s AI Employee · {now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* AI Employee framing */}
      <div className="rounded-xl border p-6 mb-6 bg-card-bg">
        <p className="text-xs font-medium uppercase tracking-wider mb-2 text-muted-foreground">This month</p>
        <p className="text-xl sm:text-2xl font-bold text-foreground">
          Your AI Employee worked <span className="text-brand-primary">{hoursWorked} hours</span>,
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
          <KpiCard label="Calls Handled" value={totalCalls} sub="this month" color="accent" animate icon={<Phone size={16} />} />
          <KpiCard label="Resolution Rate" value={`${resolutionRate}%`} sub="calls fully handled" color="success" icon={<CheckCircle size={16} />} />
          <KpiCard label="Avg Duration" value={formatDuration(avgDuration)} sub="completed calls" icon={<Clock size={16} />} />
          <KpiCard label="Hours Worked" value={hoursWorked} sub="24/7 this month" color="warning" animate icon={<Zap size={16} />} />
        </div>
      </Suspense>

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
            <p className="text-sm text-muted-foreground">Call reasons will appear as more calls are logged.</p>
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
