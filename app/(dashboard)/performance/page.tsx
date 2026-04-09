import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { CallLog } from '@/lib/types'

type SentimentRow = {
  sentiment: string | null
}

function StatCard({ label, value, sub, color = 'var(--foreground)' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-2" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-3xl font-bold leading-none" style={{ color }}>{value}</span>
      {sub && <span className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</span>}
    </div>
  )
}

function SentimentBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{label}</span>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>{count} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: 'var(--border)' }}>
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default async function PerformancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let calls: CallLog[] = []
  let sentiments: SentimentRow[] = []
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  if (clientId) {
    const { data } = await supabase
      .from('call_logs')
      .select('status, duration_seconds, direction, started_at, ended_at')
      .eq('client_id', clientId)
      .gte('started_at', monthStart.toISOString())
    calls = (data ?? []) as CallLog[]

    const { data: sents } = await supabase
      .from('call_logs')
      .select('sentiment')
      .eq('client_id', clientId)
      .gte('started_at', monthStart.toISOString())
    sentiments = (sents ?? []) as SentimentRow[]
  }

  const totalCalls = calls.length
  const answeredCalls = calls.filter(c => c.status === 'completed').length
  const resolutionRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0

  // Hours worked this month (AI answers 24/7 — fixed metric)
  const daysThisMonth = now.getDate()
  const hoursWorked = daysThisMonth * 24

  // Average response time — we don't have "ring time", so use avg duration as proxy
  const durations = calls.filter(c => c.duration_seconds && c.status === 'completed').map(c => c.duration_seconds!)
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0
  const avgDurationStr = avgDuration > 0 ? `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s` : '—'

  // Sentiment breakdown
  const posCount = sentiments.filter(s => s.sentiment === 'positive').length
  const neuCount = sentiments.filter(s => s.sentiment === 'neutral' || !s.sentiment).length
  const negCount = sentiments.filter(s => s.sentiment === 'negative').length
  const sentTotal = sentiments.length || 1

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Performance</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Your AI Employee&apos;s stats · {now.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>Setup required:</strong> Account not linked. Contact Olybuddy.
          </p>
        </div>
      )}

      {/* AI Employee framing */}
      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>This month</p>
        <p className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
          Your AI Employee worked <span style={{ color: 'var(--accent)' }}>{hoursWorked} hours</span>, handled <span style={{ color: 'var(--success)' }}>{totalCalls} calls</span>, and never took a day off.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Calls Handled" value={totalCalls} sub="this month" color="var(--accent)" />
        <StatCard label="Resolution Rate" value={`${resolutionRate}%`} sub="calls fully handled" color="var(--success)" />
        <StatCard label="Avg Call Duration" value={avgDurationStr} sub="completed calls" />
        <StatCard label="Hours Worked" value={hoursWorked} sub="24/7 this month" color="var(--warning)" />
      </div>

      {/* Sentiment breakdown */}
      <div className="rounded-xl border p-6" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 className="text-sm font-semibold mb-5" style={{ color: 'var(--foreground)' }}>Caller Sentiment</h2>
        {sentiments.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Sentiment data will appear after calls are processed.</p>
        ) : (
          <div className="space-y-4">
            <SentimentBar label="Positive" count={posCount} total={sentTotal} color="var(--success)" />
            <SentimentBar label="Neutral" count={neuCount} total={sentTotal} color="var(--muted)" />
            <SentimentBar label="Negative" count={negCount} total={sentTotal} color="var(--danger)" />
          </div>
        )}
      </div>
    </div>
  )
}
