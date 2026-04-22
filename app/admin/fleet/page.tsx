import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserSession } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Fleet · Nexley Admin' };
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface FleetRow {
  client_id: string;
  client_name: string;
  slug: string;
  vps_ip: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
  agent_pulse: {
    last_beat_at: string | null;
    stale: boolean | null;
    tmux_ok: boolean | null;
    pulse_age_sec: number | null;
  } | null;
  subscription_alert: { severity: string; expires_in_sec: number } | null;
  provisioning_alerts: number;
}

function ageSec(ts: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 1000);
}

function statusColor(row: FleetRow): 'green' | 'amber' | 'red' {
  if (!row.agent_pulse?.last_beat_at) return 'red';
  const age = ageSec(row.agent_pulse.last_beat_at) ?? 9999;
  if (row.agent_pulse.stale || !row.agent_pulse.tmux_ok) return 'red';
  if (age > 120 || row.subscription_alert?.severity === 'critical' || row.provisioning_alerts > 0) return 'amber';
  if (age > 60 || row.subscription_alert) return 'amber';
  return 'green';
}

export default async function AdminFleetPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const session = getUserSession(user);
  if (session.role !== 'super_admin') redirect('/dashboard');

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const [clientsRes, pulsesRes, subsRes, provAlertsRes, provHbRes] = await Promise.all([
    service.from('clients').select('id, name, slug, vps_ip, subscription_status, trial_ends_at').order('created_at', { ascending: false }),
    service.from('agent_pulse').select('client_id, last_beat_at, stale, tmux_ok, pulse_age_sec'),
    service.from('subscription_expiry_alerts').select('client_id, severity, expires_in_sec'),
    service.from('provisioning_alerts').select('client_id').is('resolved_at', null),
    service.from('provisioning_heartbeat').select('hostname, last_beat_at, queue_depth'),
  ]);

  const pulseByClient = new Map((pulsesRes.data ?? []).map((p) => [p.client_id, p]));
  const subByClient = new Map((subsRes.data ?? []).map((s) => [s.client_id, s]));
  const alertCount = new Map<string, number>();
  for (const a of provAlertsRes.data ?? []) {
    alertCount.set(a.client_id, (alertCount.get(a.client_id) ?? 0) + 1);
  }

  const rows: FleetRow[] = (clientsRes.data ?? []).map((c) => ({
    client_id: c.id,
    client_name: c.name ?? c.slug ?? 'untitled',
    slug: c.slug,
    vps_ip: (c as { vps_ip?: string | null }).vps_ip ?? null,
    subscription_status: c.subscription_status ?? 'unknown',
    trial_ends_at: (c as { trial_ends_at?: string | null }).trial_ends_at ?? null,
    agent_pulse: pulseByClient.get(c.id) ?? null,
    subscription_alert: subByClient.get(c.id) ?? null,
    provisioning_alerts: alertCount.get(c.id) ?? 0,
  }));

  const prov = provHbRes.data ?? [];

  return (
    <div className="max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-1">Fleet health</h1>
      <p className="text-sm text-slate-400 mb-6">Live view of every VPS. Refreshes every 30s.</p>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-2">Provisioning poller</h2>
        <div className="rounded-lg border border-white/10 bg-slate-900/50 divide-y divide-white/5">
          {prov.length === 0 && <div className="p-4 text-sm text-red-400">⚠ No poller heartbeats ever recorded — install/restart provision-queue-poller.sh</div>}
          {prov.map((h) => {
            const age = ageSec(h.last_beat_at) ?? 9999;
            const ok = age < 1800;
            return (
              <div key={h.hostname} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="font-mono">{h.hostname}</span>
                <span className="text-slate-400">last beat: {age}s ago · queue: {h.queue_depth ?? '?'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-2">Clients</h2>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/70 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Client</th>
                <th className="text-left px-4 py-2">Plan</th>
                <th className="text-left px-4 py-2">Pulse</th>
                <th className="text-left px-4 py-2">Subscription</th>
                <th className="text-left px-4 py-2">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => {
                const color = statusColor(r);
                const age = ageSec(r.agent_pulse?.last_beat_at ?? null);
                return (
                  <tr key={r.client_id} className="bg-slate-900/40">
                    <td className="px-4 py-2 flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${color === 'green' ? 'bg-emerald-400' : color === 'amber' ? 'bg-amber-400' : 'bg-red-400'}`} />
                      <span className="font-medium">{r.client_name}</span>
                      <span className="text-slate-500 font-mono text-xs">{r.slug}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-300">
                      {r.subscription_status}
                      {(r.subscription_status === 'trial' || r.subscription_status === 'ai-employee-trial') && (
                        <Link
                          href={`/admin/close/${r.client_id}`}
                          className="ml-2 text-xs font-medium text-purple-400 hover:text-purple-300 transition-colors"
                        >
                          Close →
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-400">{age == null ? 'never' : `${age}s`}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {r.subscription_alert
                        ? <span className={r.subscription_alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                            {r.subscription_alert.severity} · {Math.round(r.subscription_alert.expires_in_sec / 3600)}h left
                          </span>
                        : <span className="text-emerald-400/70">ok</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-400">
                      {r.provisioning_alerts > 0
                        ? <span className="text-red-400">{r.provisioning_alerts} open</span>
                        : <span>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
