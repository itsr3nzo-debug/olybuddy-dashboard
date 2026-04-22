import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pollFergusForClient, type PollResult } from '@/lib/integrations/fergus-poller'

/**
 * GET /api/cron/fergus-poll
 *
 * Vercel cron runs this every minute. For each client with a connected
 * Fergus integration, polls the Partner API and emits integration_signals
 * for new jobs / completed jobs / new customers / new sites.
 *
 * Why self-poll (not Zapier):
 *   Zapier's Fergus app polls at 15-min cadence on every tier below
 *   Company ($103+/mo). We match or beat that (1 min) for zero cost +
 *   no SPOF + no per-client OAuth consent.
 *
 * Auth: bearer `CRON_SECRET` — Vercel cron adds this automatically.
 *
 * Per-run budget: each client uses ~4 Fergus requests. At 10 clients,
 * that's 40 req/min spread across 10 tenants (Fergus's 100/min limit is
 * per-company, not global — we have plenty of headroom).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Allow a bit of wall-clock for Fergus; Vercel Pro gives 60s for cron.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  // Optional ?client_id= to poll one tenant (useful for manual smoke tests).
  const forClient = new URL(req.url).searchParams.get('client_id')

  const query = sb
    .from('integrations')
    .select('client_id')
    .eq('provider', 'fergus')
    .eq('status', 'connected')
  const { data: rows, error: listErr } = forClient
    ? await query.eq('client_id', forClient)
    : await query

  if (listErr) {
    return NextResponse.json({ error: 'list_failed', detail: listErr.message }, { status: 500 })
  }
  const clientIds = (rows ?? []).map(r => r.client_id as string)

  if (clientIds.length === 0) {
    return NextResponse.json({ polled: 0, message: 'No connected Fergus integrations' })
  }

  // Cap concurrency so one slow Fergus tenant doesn't starve the run.
  const CONCURRENCY = 5
  const results: PollResult[] = []
  for (let i = 0; i < clientIds.length; i += CONCURRENCY) {
    const batch = clientIds.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(batch.map(id => pollFergusForClient(sb, id).catch((e: unknown) => ({
      client_id: id,
      signals_emitted: 0,
      jobs_seen: 0, customers_seen: 0, sites_seen: 0, quotes_seen: 0,
      duration_ms: 0, seeded_this_run: false,
      error: `unhandled: ${e instanceof Error ? e.message : String(e)}`,
    } as PollResult))))
    results.push(...batchResults)
  }

  const totalSignals = results.reduce((a, r) => a + r.signals_emitted, 0)
  const failures = results.filter(r => r.error)

  return NextResponse.json({
    polled: results.length,
    signals_emitted: totalSignals,
    failures: failures.length,
    results,
  })
}
