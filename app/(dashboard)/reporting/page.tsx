import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import KpiCard, { KpiCardSkeleton } from '@/components/dashboard/KpiCard'
import { Phone, CheckCircle, Clock, Users, TrendingUp, PoundSterling } from 'lucide-react'
import { formatDuration, formatCurrency } from '@/lib/format'
import { PIPELINE_STAGES, COST_PER_CALL_PENCE } from '@/lib/constants'

export const metadata: Metadata = { title: 'Reporting | Nexley AI' }

export default async function ReportingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  const now = new Date()
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  let calls: Array<Record<string, unknown>> = []
  let opps: Array<Record<string, unknown>> = []

  if (clientId) {
    const [callsRes, oppsRes] = await Promise.all([
      supabase.from('call_logs').select('status, duration_seconds, from_number, started_at, direction').eq('client_id', clientId).gte('started_at', thirtyDaysAgo.toISOString()),
      supabase.from('opportunities').select('stage, value_pence').eq('client_id', clientId),
    ])
    calls = (callsRes.data ?? []) as Array<Record<string, unknown>>
    opps = (oppsRes.data ?? []) as Array<Record<string, unknown>>
  }

  // Call stats
  const totalCalls = calls.length
  const answered = calls.filter(c => c.status === 'completed').length
  const missed = calls.filter(c => c.status === 'no_answer' || c.status === 'failed').length
  const answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0
  const durations = calls.filter(c => c.duration_seconds).map(c => c.duration_seconds as number)
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
  const uniqueCallers = new Set(calls.map(c => c.from_number).filter(Boolean)).size
  const inbound = calls.filter(c => c.direction === 'inbound').length
  const moneySaved = answered * COST_PER_CALL_PENCE

  // Pipeline stats
  const totalOpps = opps.length
  const wonOpps = opps.filter(o => o.stage === 'won').length
  const pipelineValue = opps.reduce((sum, o) => sum + ((o.value_pence as number) ?? 0), 0)
  const wonValue = opps.filter(o => o.stage === 'won').reduce((sum, o) => sum + ((o.value_pence as number) ?? 0), 0)
  const conversionRate = totalOpps > 0 ? Math.round((wonOpps / totalOpps) * 100) : 0

  // Stage breakdown
  const stageBreakdown = PIPELINE_STAGES.map(s => {
    const stageOpps = opps.filter(o => o.stage === s.key)
    return { label: s.label, hex: s.hex, count: stageOpps.length, value: stageOpps.reduce((sum, o) => sum + ((o.value_pence as number) ?? 0), 0) }
  }).filter(s => s.count > 0)

  // Call outcome breakdown
  const outcomes = [
    { label: 'Answered', count: answered, color: '#22c55e' },
    { label: 'Missed', count: calls.filter(c => c.status === 'no_answer').length, color: '#f59e0b' },
    { label: 'Failed', count: calls.filter(c => c.status === 'failed').length, color: '#ef4444' },
    { label: 'Voicemail', count: calls.filter(c => c.status === 'voicemail').length, color: '#3b82f6' },
  ].filter(o => o.count > 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Reporting</h1>
        <p className="text-sm mt-1 text-muted-foreground">Last 30 days · Comprehensive analytics</p>
      </div>

      {/* Call Report */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Call Report</h2>
        <Suspense fallback={<div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{[0,1,2,3].map(i => <KpiCardSkeleton key={i} />)}</div>}>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
            <KpiCard label="Total Calls" value={totalCalls} color="accent" animate icon={<Phone size={16} />} />
            <KpiCard label="Answer Rate" value={`${answerRate}%`} color={answerRate >= 90 ? 'success' : 'warning'} icon={<CheckCircle size={16} />} />
            <KpiCard label="Avg Duration" value={formatDuration(avgDuration)} icon={<Clock size={16} />} />
            <KpiCard label="Unique Callers" value={uniqueCallers} animate icon={<Users size={16} />} />
          </div>
        </Suspense>

        {/* Outcome breakdown */}
        <div className="rounded-xl border p-5 bg-card" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold text-foreground mb-3">Call Outcomes</h3>
          <div className="space-y-3">
            {outcomes.map(o => {
              const pct = totalCalls > 0 ? Math.round((o.count / totalCalls) * 100) : 0
              return (
                <div key={o.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm text-foreground">{o.label}</span>
                    <span className="text-sm text-muted-foreground">{o.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: o.color }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground">Inbound Calls</p>
              <p className="text-lg font-bold text-foreground">{inbound}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Money Saved</p>
              <p className="text-lg font-bold text-brand-success">{formatCurrency(moneySaved)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pipeline Report */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Pipeline Report</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
          <KpiCard label="Total Deals" value={totalOpps} color="accent" animate icon={<TrendingUp size={16} />} />
          <KpiCard label="Won Deals" value={wonOpps} color="success" animate icon={<CheckCircle size={16} />} />
          <KpiCard label="Pipeline Value" value={formatCurrency(pipelineValue)} color="accent" icon={<PoundSterling size={16} />} />
          <KpiCard label="Conversion Rate" value={`${conversionRate}%`} color={conversionRate >= 20 ? 'success' : 'default'} icon={<TrendingUp size={16} />} />
        </div>

        {/* Stage breakdown */}
        <div className="rounded-xl border p-5 bg-card" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold text-foreground mb-3">Stage Breakdown</h3>
          <div className="space-y-3">
            {stageBreakdown.map(s => (
              <div key={s.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.hex }} />
                  <span className="text-sm text-foreground">{s.label}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">{s.count} deal{s.count !== 1 ? 's' : ''}</span>
                  <span className="text-sm font-semibold text-brand-success">{formatCurrency(s.value)}</span>
                </div>
              </div>
            ))}
          </div>
          {wonValue > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">Total Won Revenue</p>
              <p className="text-2xl font-bold text-brand-success">{formatCurrency(wonValue)}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
