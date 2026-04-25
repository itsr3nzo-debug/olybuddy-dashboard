import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'SLO Dashboard | Nexley AI Admin' }
export const dynamic = 'force-dynamic'

/**
 * /admin/slo — Item #10 admin monitoring dashboard.
 *
 * Reads from real columns confirmed via information_schema (devil's-advocate
 * fix P0 #10):
 *   - webhook_log         → API failure indicator (rows with response_status >=500)
 *   - stripe_events       → webhook ingest reliability (processed flag)
 *   - agent_heartbeats    → per-client uptime via agent_slug → clients.slug match
 *                           (NOT client_id — heartbeats don't have that column)
 *   - clients             → vps_ready_at exists; provisioning latency calc OK
 *   - integration_signals → vps-backup snapshot count + CSP violation feed
 *
 * Super-admin only. Refresh on every load (no caching) so the numbers
 * reflect live state.
 */
export default async function SloDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = (user.app_metadata as { role?: string } | null)?.role
  if (role !== 'super_admin') redirect('/dashboard')

  const now = Date.now()
  const thirtyDays = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const sevenDays = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const oneDay = new Date(now - 24 * 60 * 60 * 1000).toISOString()

  // ─── KPI 1: Webhook 5xx rate (30d) ──────────────────────────────────────
  // Use webhook_log rows with response_status >= 500 vs total. The previous
  // version queried audit_logs.level which doesn't exist in our schema.
  const [webhookErr, webhookTotal] = await Promise.all([
    supabase
      .from('webhook_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', thirtyDays)
      .gte('response_status', 500),
    supabase
      .from('webhook_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', thirtyDays),
  ])
  const webhookErrCount = webhookErr.count ?? 0
  const webhookTotalCount = webhookTotal.count ?? 0
  const webhookErrRate = webhookTotalCount > 0 ? (webhookErrCount / webhookTotalCount) * 100 : 0

  // ─── KPI 2: Stripe webhook success rate (30d) ───────────────────────────
  const [stripeTotalRes, stripeProcessedRes] = await Promise.all([
    supabase
      .from('stripe_events')
      .select('stripe_event_id', { count: 'exact', head: true })
      .gte('created_at', thirtyDays),
    supabase
      .from('stripe_events')
      .select('stripe_event_id', { count: 'exact', head: true })
      .gte('created_at', thirtyDays)
      .eq('processed', true),
  ])
  const stripeTotal = stripeTotalRes.count ?? 0
  const stripeProcessed = stripeProcessedRes.count ?? 0
  const stripeRate = stripeTotal > 0 ? (stripeProcessed / stripeTotal) * 100 : 100

  // ─── KPI 3: Per-client agent uptime ─────────────────────────────────────
  // agent_heartbeats has agent_slug + timestamp (NOT last_beat_at + client_id).
  // Match heartbeat to client via slug OR vps_service_slug.
  //
  // Round-2 fix #10: stale threshold is configurable via env, defaults to
  // 5 min. Some agents beat every 15 min — hardcoding 5 reports them as
  // stale even when healthy. Set HEARTBEAT_STALE_MINUTES=15 in Vercel
  // env if your fleet uses a slower beat cadence.
  const STALE_MIN = Math.max(2, parseInt(process.env.HEARTBEAT_STALE_MINUTES || '5', 10))

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug, vps_service_slug, vps_status, subscription_status')
    .in('subscription_status', ['active', 'trial'])
    .not('slug', 'is', null)
    .order('name')

  const clientList = clients || []

  // Round-2 fix #10: narrow the heartbeat query to ONLY the slugs we
  // actually care about. Previously fetched every heartbeat in the last
  // hour into memory — fine at 5 clients, eats memory at 100. Build the
  // candidate-slug set from clients.slug + clients.vps_service_slug, then
  // .in() filter so we don't drag the whole heartbeat history through.
  const candidateSlugs = new Set<string>()
  for (const c of clientList) {
    const r = c as { slug: string; vps_service_slug: string | null }
    if (r.slug) candidateSlugs.add(r.slug)
    if (r.vps_service_slug) candidateSlugs.add(r.vps_service_slug)
  }
  // 1.5x the stale threshold for the lookup window — captures the
  // most-recent beat even on slow-cadence agents.
  const heartbeatLookbackMs = STALE_MIN * 1.5 * 60 * 1000
  const { data: recentBeats } = candidateSlugs.size > 0
    ? await supabase
        .from('agent_heartbeats')
        .select('agent_slug, timestamp')
        .in('agent_slug', Array.from(candidateSlugs))
        .gte('timestamp', new Date(now - heartbeatLookbackMs).toISOString())
        .order('timestamp', { ascending: false })
    : { data: [] as Array<{ agent_slug: string; timestamp: string }> }

  const lastBeatBySlug = new Map<string, string>()
  for (const b of (recentBeats || []) as Array<{ agent_slug: string; timestamp: string }>) {
    if (!lastBeatBySlug.has(b.agent_slug)) lastBeatBySlug.set(b.agent_slug, b.timestamp)
  }

  const heartbeatStatuses = clientList.map(c => {
    const r = c as { name: string; slug: string; vps_service_slug: string | null }
    const candidates = [r.slug, r.vps_service_slug].filter(Boolean) as string[]
    let lastBeat: string | null = null
    for (const k of candidates) {
      const beat = lastBeatBySlug.get(k)
      if (beat && (!lastBeat || beat > lastBeat)) lastBeat = beat
    }
    const staleMinutes = lastBeat ? Math.floor((now - new Date(lastBeat).getTime()) / 60000) : null
    return {
      slug: r.slug,
      name: r.name,
      lastBeat,
      staleMinutes,
      ok: staleMinutes !== null && staleMinutes < STALE_MIN,
    }
  })

  const liveClients = heartbeatStatuses.filter(s => s.ok).length
  const uptimeRate = heartbeatStatuses.length > 0
    ? (liveClients / heartbeatStatuses.length) * 100
    : 100

  // ─── KPI 4: Provisioning latency (signup -> vps_ready_at, 30d) ─────────
  // Round-2 fix #10: include trial customers. Previously filtered to
  // 'active' only — but provisioning happens DURING the trial, so most
  // recent provisioning data was being excluded. Now: any client whose
  // VPS got marked ready in the last 30 days, regardless of where they
  // are in the lifecycle now (cancelled customers' provisioning latency
  // still tells us about the funnel).
  const { data: recentPaid } = await supabase
    .from('clients')
    .select('created_at, vps_ready_at, subscription_status')
    .in('subscription_status', ['trial', 'active', 'cancelled'])
    .gte('created_at', thirtyDays)
    .not('vps_ready_at', 'is', null)
    .limit(100)

  const provLatencies = ((recentPaid || []) as Array<{ created_at: string; vps_ready_at: string | null }>)
    .map(c => c.vps_ready_at ? (new Date(c.vps_ready_at).getTime() - new Date(c.created_at).getTime()) / 60000 : 0)
    .filter(n => n > 0)
    .sort((a, b) => a - b)
  const p95Index = Math.max(0, Math.floor(provLatencies.length * 0.95) - 1)
  const provP95Min = provLatencies.length > 0
    ? Math.round(provLatencies[Math.min(p95Index, provLatencies.length - 1)])
    : 0

  // ─── KPI 5: VPS backup health (last 24h) ────────────────────────────────
  const { count: backupsLast24h } = await supabase
    .from('integration_signals')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'vps-backup')
    .eq('kind', 'snapshot_uploaded')
    .gte('occurred_at', oneDay)
  const expectedBackups = clientList.length
  const backupHealthOk = (backupsLast24h ?? 0) >= expectedBackups || expectedBackups === 0

  // ─── KPI 6: CSP violations (last 24h) — surfaces during the report-only
  //  rollout window so we can see what to tighten before flipping enforce.
  const { count: cspViolations24h } = await supabase
    .from('integration_signals')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'csp')
    .eq('kind', 'violation')
    .gte('occurred_at', oneDay)
  const cspOk = (cspViolations24h ?? 0) < 25  // heuristic: <25/day = stable

  // ─── KPI 7: Pending P0/P1 alerts (7d, unacknowledged) ───────────────────
  const { data: pendingAlerts } = await supabase
    .from('agent_alerts')
    .select('id, target_agent, priority, category, subject, created_at')
    .gte('created_at', sevenDays)
    .in('priority', ['P0', 'P1'])
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-1">SLO Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Live status against targets in <code>docs/operations/SLO-SLA.md</code>. Last 30d unless noted.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <SloCard
          label="Webhook 5xx rate"
          value={`${webhookErrRate.toFixed(2)}%`}
          target="< 1.0%"
          ok={webhookErrRate < 1.0}
          sub={`${webhookErrCount} 5xx / ${webhookTotalCount} total`}
        />
        <SloCard
          label="Stripe webhook success"
          value={`${stripeRate.toFixed(1)}%`}
          target="> 99.5%"
          ok={stripeRate >= 99.5}
          sub={`${stripeProcessed} processed / ${stripeTotal} total`}
        />
        <SloCard
          label="VPS heartbeat health"
          value={`${uptimeRate.toFixed(1)}%`}
          target="> 99.0%"
          ok={uptimeRate >= 99.0}
          sub={`${liveClients} of ${heartbeatStatuses.length} clients live (heartbeat <5min)`}
        />
        <SloCard
          label="Provisioning p95"
          value={`${provP95Min}min`}
          target="< 20min"
          ok={(provP95Min < 20 || provLatencies.length === 0)}
          sub={`${provLatencies.length} paid signups in window`}
        />
        <SloCard
          label="Backups in last 24h"
          value={`${backupsLast24h ?? 0} / ${expectedBackups}`}
          target="all clients"
          ok={!!backupHealthOk}
          sub={backupHealthOk ? 'On track' : 'Some backups missed — investigate'}
        />
        <SloCard
          label="CSP violations (24h)"
          value={`${cspViolations24h ?? 0}`}
          target="< 25/day"
          ok={cspOk}
          sub={cspOk ? 'Policy stable, ready for enforce flip' : 'Review before flipping CSP_ENFORCE'}
        />
        <SloCard
          label="Pending P0/P1 alerts (7d)"
          value={`${pendingAlerts?.length ?? 0}`}
          target="0 unacknowledged"
          ok={(pendingAlerts?.length ?? 0) === 0}
          sub="Light + Senku inbox"
        />
      </div>

      <h2 className="text-lg font-semibold mb-3 text-foreground">Per-client heartbeat</h2>
      <div className="rounded-xl border border-border overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-3 font-medium">Client</th>
              <th className="p-3 font-medium">Last heartbeat</th>
              <th className="p-3 font-medium">Stale</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {heartbeatStatuses.map(s => (
              <tr key={s.slug} className="border-t border-border">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-muted-foreground">{s.lastBeat ? new Date(s.lastBeat).toUTCString() : '—'}</td>
                <td className="p-3 text-muted-foreground">{s.staleMinutes !== null ? `${s.staleMinutes}m` : '—'}</td>
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {s.ok ? 'live' : 'stale'}
                  </span>
                </td>
              </tr>
            ))}
            {heartbeatStatuses.length === 0 && (
              <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No active clients with heartbeats yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold mb-3 text-foreground">Pending P0 / P1 alerts</h2>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-3 font-medium">When</th>
              <th className="p-3 font-medium">Pri</th>
              <th className="p-3 font-medium">Agent</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Subject</th>
            </tr>
          </thead>
          <tbody>
            {(pendingAlerts || []).map(a => {
              const r = a as { id: string; target_agent: string; priority: string; category: string; subject: string; created_at: string }
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3 text-muted-foreground">{new Date(r.created_at).toUTCString()}</td>
                  <td className="p-3"><span className={`text-xs font-bold ${r.priority === 'P0' ? 'text-red-400' : 'text-amber-400'}`}>{r.priority}</span></td>
                  <td className="p-3 font-medium">{r.target_agent}</td>
                  <td className="p-3 text-muted-foreground">{r.category}</td>
                  <td className="p-3">{r.subject}</td>
                </tr>
              )
            })}
            {(pendingAlerts || []).length === 0 && (
              <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No pending P0/P1 alerts in last 7d.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SloCard({ label, value, target, ok, sub }: { label: string; value: string; target: string; ok: boolean; sub: string }) {
  return (
    <div className={`rounded-xl border p-4 ${ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold mb-1 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{value}</p>
      <p className="text-xs text-muted-foreground">Target: {target}</p>
      <p className="text-xs mt-2 text-muted-foreground">{sub}</p>
    </div>
  )
}
