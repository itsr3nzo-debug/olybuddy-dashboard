import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/provisioning-watchdog
 *
 * Vercel cron — runs daily. Detects two ops failures:
 *   1) Mac-side provision-queue-poller has stopped heartbeating (laptop
 *      sleeping, script crashed, Mac dead). Any poller heartbeat older than
 *      30 min → alert.
 *   2) Any client stuck in "pending" for >6h (scp failed silently, deploy-
 *      client.sh errored, human forgot a step). Insert a provisioning_alerts
 *      row so operator dashboard shows it and Telegram bot pings.
 *
 * Roadmap items #7 + #8 from 2026-04-21 audit.
 */

const CRON_SECRET = process.env.CRON_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT = process.env.TELEGRAM_OPS_CHAT_ID;

async function notifyTelegram(text: string) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.warn('[provisioning-watchdog] telegram notify failed', e);
  }
}

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const issues: Array<{ kind: string; detail: string }> = [];

  // 1) Poller heartbeat freshness
  const { data: heartbeats } = await service
    .from('provisioning_heartbeat')
    .select('hostname, last_beat_at, queue_depth');
  const staleThreshold = Date.now() - 30 * 60 * 1000;
  const staleHosts = (heartbeats ?? []).filter(
    (h) => new Date(h.last_beat_at).getTime() < staleThreshold
  );
  for (const h of staleHosts) {
    const minsStale = Math.round((Date.now() - new Date(h.last_beat_at).getTime()) / 60000);
    issues.push({ kind: 'poller_stale', detail: `${h.hostname} last heartbeat ${minsStale}m ago` });
  }
  if ((heartbeats ?? []).length === 0) {
    issues.push({ kind: 'poller_never_beat', detail: 'no hosts have ever heartbeat — setup incomplete' });
  }

  // 2) Stuck-provisioning clients
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: stuck } = await service
    .from('clients')
    .select('id, name, slug, created_at, subscription_status, vps_ready')
    .lt('created_at', sixHoursAgo)
    .eq('vps_ready', false)
    .in('subscription_status', ['trial', 'active']);

  for (const c of stuck ?? []) {
    // Upsert an alert so repeat runs don't multiply rows
    const { data: existing } = await service
      .from('provisioning_alerts')
      .select('id')
      .eq('client_id', c.id)
      .eq('alert_type', 'vps_not_ready')
      .is('resolved_at', null)
      .maybeSingle();
    if (!existing) {
      await service.from('provisioning_alerts').insert({
        client_id: c.id,
        alert_type: 'vps_not_ready',
        details: { slug: c.slug, name: c.name, created_at: c.created_at },
      });
      issues.push({
        kind: 'client_stuck',
        detail: `${c.name || c.slug} (${c.id}) — vps_ready=false since ${c.created_at}`,
      });
    }
  }

  if (issues.length > 0) {
    const summary = issues
      .map((i) => `• <b>${i.kind}</b> — ${i.detail}`)
      .join('\n');
    await notifyTelegram(`⚠️ <b>Nexley ops alert</b>\n${summary}`);
  }

  return NextResponse.json({
    ok: true,
    stale_hosts: staleHosts.length,
    stuck_clients: (stuck ?? []).length,
    issues,
  });
}
