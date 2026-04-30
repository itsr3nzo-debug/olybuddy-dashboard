'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Activity, AlertCircle, CheckCircle2, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react'

interface FleetMetric {
  client_id: string
  date: string
  heartbeat_age_min: number | null
  qa_avg: number | null
  qa_count: number
  regression_count: number
  implicit_bad_count: number
  integrations_active: string[] | null
  top_failure_patterns: Array<{ pattern: string; count: number }> | null
  reply_latency_p50_ms: number | null
  reply_latency_p95_ms: number | null
  reply_latency_p99_ms: number | null
  reply_count_24h: number | null
}

interface CandidateRule {
  pattern: string
  client_count: number
  total_hits: number
  status: 'candidate' | 'approved' | 'rejected'
  first_seen: string
}

interface AgentAlert {
  id: string
  client_id: string
  severity: string
  category: string
  summary: string
  details: string | null
  created_at: string
}

export default function LearningPage() {
  const [metrics, setMetrics] = useState<FleetMetric[]>([])
  const [candidates, setCandidates] = useState<CandidateRule[]>([])
  const [alerts, setAlerts] = useState<AgentAlert[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const [m, c, a] = await Promise.all([
        supabase.from('fleet_metrics').select('*').gte('date', since).order('date', { ascending: false }),
        supabase.from('fleet_rules_shared').select('*').order('total_hits', { ascending: false }),
        supabase.from('agent_alerts').select('*').eq('category', 'agent_regression').order('created_at', { ascending: false }).limit(20),
      ])
      setMetrics((m.data || []) as FleetMetric[])
      setCandidates((c.data || []) as CandidateRule[])
      setAlerts((a.data || []) as AgentAlert[])
      setLoading(false)
    }
    load()
  }, [])

  async function approveRule(pattern: string, status: 'approved' | 'rejected') {
    await supabase.from('fleet_rules_shared').update({ status }).eq('pattern', pattern)
    setCandidates(candidates.map(c => (c.pattern === pattern ? { ...c, status } : c)))
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading…</div>
  }

  // Latest metrics per client
  const latestByClient = new Map<string, FleetMetric>()
  for (const m of metrics) {
    if (!latestByClient.has(m.client_id) || m.date > latestByClient.get(m.client_id)!.date) {
      latestByClient.set(m.client_id, m)
    }
  }
  const latest = Array.from(latestByClient.values())

  // Fleet-wide aggregates
  const fleetQaAvg = (() => {
    const scored = latest.filter(m => m.qa_avg !== null)
    if (!scored.length) return null
    return (scored.reduce((acc, m) => acc + (m.qa_avg || 0), 0) / scored.length).toFixed(2)
  })()
  const totalRegressions24h = latest.reduce((acc, m) => acc + m.regression_count, 0)
  const totalImplicitBad24h = latest.reduce((acc, m) => acc + m.implicit_bad_count, 0)
  const fleetP95Ms = (() => {
    const have = latest.filter(m => m.reply_latency_p95_ms !== null && m.reply_latency_p95_ms !== undefined)
    if (!have.length) return null
    return Math.max(...have.map(m => m.reply_latency_p95_ms || 0))
  })()
  const totalReplies24h = latest.reduce((acc, m) => acc + (m.reply_count_24h || 0), 0)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Learning</h1>
        <p className="text-sm text-muted-foreground">
          How your AI Employees are performing and what they're learning. Updated daily.
        </p>
      </div>

      {/* Fleet-level KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={<Activity className="size-5 text-primary" />}
          label="Fleet QA score"
          value={fleetQaAvg ?? '—'}
          subtitle="0-5 avg, last 24h"
        />
        <KpiCard
          icon={<TrendingDown className="size-5 text-destructive" />}
          label="Regressions (24h)"
          value={totalRegressions24h.toString()}
          subtitle="Forbidden phrase usage"
          tone={totalRegressions24h > 0 ? 'bad' : 'good'}
        />
        <KpiCard
          icon={<ThumbsDown className="size-5 text-warning" />}
          label="Implicit-bad (24h)"
          value={totalImplicitBad24h.toString()}
          subtitle="Owner re-asks, complaints"
          tone={totalImplicitBad24h > 0 ? 'bad' : 'good'}
        />
        <KpiCard
          icon={<TrendingUp className="size-5 text-primary" />}
          label="Reply P95 (24h)"
          value={fleetP95Ms !== null ? `${(fleetP95Ms / 1000).toFixed(1)}s` : '—'}
          subtitle={`${totalReplies24h} replies; SLO 30s`}
          tone={fleetP95Ms !== null && fleetP95Ms > 30000 ? 'bad' : (fleetP95Ms !== null ? 'good' : undefined)}
        />
      </div>

      {/* Per-client metrics table */}
      <section className="mb-8">
        <h2 className="text-lg font-medium mb-3">Per-client</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Client</th>
                <th className="text-left px-4 py-3 font-medium">Heartbeat</th>
                <th className="text-left px-4 py-3 font-medium">QA</th>
                <th className="text-left px-4 py-3 font-medium">Regressions</th>
                <th className="text-left px-4 py-3 font-medium">Implicit bad</th>
                <th className="text-left px-4 py-3 font-medium">P50 / P95 / P99 (ms)</th>
                <th className="text-left px-4 py-3 font-medium">Integrations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {latest.map(m => (
                <tr key={m.client_id} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-mono text-xs">{m.client_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3">
                    {m.heartbeat_age_min === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : m.heartbeat_age_min < 10 ? (
                      <span className="text-success flex items-center gap-1.5"><CheckCircle2 className="size-3" /> {m.heartbeat_age_min}m</span>
                    ) : m.heartbeat_age_min < 120 ? (
                      <span className="text-warning">{m.heartbeat_age_min}m</span>
                    ) : (
                      <span className="text-destructive flex items-center gap-1.5"><AlertCircle className="size-3" /> stale ({Math.round(m.heartbeat_age_min)}m)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.qa_avg === null ? <span className="text-muted-foreground">—</span> : <span className="font-medium">{m.qa_avg}</span>}
                    <span className="text-xs text-muted-foreground ml-2">({m.qa_count})</span>
                  </td>
                  <td className="px-4 py-3">
                    {m.regression_count > 0 ? (
                      <span className="text-destructive font-medium">{m.regression_count}</span>
                    ) : (
                      <span className="text-success">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {m.implicit_bad_count > 0 ? (
                      <span className="text-warning font-medium">{m.implicit_bad_count}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {m.reply_latency_p95_ms === null || m.reply_latency_p95_ms === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={m.reply_latency_p95_ms > 30000 ? 'text-destructive font-medium' : 'text-success'}>
                        {Math.round(m.reply_latency_p50_ms || 0)} / {Math.round(m.reply_latency_p95_ms || 0)} / {Math.round(m.reply_latency_p99_ms || 0)}
                        <span className="text-muted-foreground ml-1">({m.reply_count_24h || 0})</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {m.integrations_active?.join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Candidate rules */}
      <section className="mb-8">
        <h2 className="text-lg font-medium mb-3">Candidate fleet rules</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Patterns detected across multiple clients. Approve to add to all bots, reject to dismiss.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No candidate rules yet.</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map(c => (
              <li key={c.pattern} className="flex items-center justify-between p-3 bg-muted/40 rounded-md border border-border">
                <div>
                  <code className="text-sm font-mono">{c.pattern}</code>
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.total_hits} hit(s) across {c.client_count} client(s) — first seen {new Date(c.first_seen).toLocaleDateString('en-GB')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === 'candidate' ? (
                    <>
                      <button onClick={() => approveRule(c.pattern, 'approved')} className="text-xs px-3 py-1.5 bg-success/10 text-success rounded-md hover:bg-success/20"><ThumbsUp className="size-3 inline mr-1" />Approve</button>
                      <button onClick={() => approveRule(c.pattern, 'rejected')} className="text-xs px-3 py-1.5 bg-destructive/10 text-destructive rounded-md hover:bg-destructive/20"><ThumbsDown className="size-3 inline mr-1" />Reject</button>
                    </>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded-md ${c.status === 'approved' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {c.status}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent regression alerts */}
      <section>
        <h2 className="text-lg font-medium mb-3">Recent regressions</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No recent regression alerts.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map(a => (
              <li key={a.id} className="p-3 bg-muted/40 rounded-md border border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-GB')}</span>
                  <span className="text-xs px-2 py-0.5 bg-destructive/10 text-destructive rounded-md">{a.severity}</span>
                </div>
                <p className="text-sm font-medium">{a.summary}</p>
                {a.details && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer">Details</summary>
                    <pre className="text-xs mt-2 p-2 bg-background rounded overflow-x-auto whitespace-pre-wrap">{a.details}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function KpiCard({ icon, label, value, subtitle, tone }: { icon: React.ReactNode; label: string; value: string; subtitle?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`p-4 rounded-lg border bg-muted/40 ${tone === 'bad' ? 'border-destructive/40' : tone === 'good' ? 'border-success/40' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  )
}
