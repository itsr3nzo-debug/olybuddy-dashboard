import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/cron/agent-alerts-prune
 *
 * Devil's-advocate fix P2 #11. Daily at 03:30 UTC. Drops processed
 * agent_alerts rows older than 90 days so the table doesn't grow
 * unbounded.
 *
 * Retention rules:
 *   - processed AND >90 days old → delete
 *   - unprocessed (poller never picked it up) at any age → KEEP — these
 *     are evidence of a broken poller or unreachable Mac Mini
 *   - resolved (set when an agent acts on the alert) follows the same
 *     90-day rule via processed_at timestamp
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('agent_alerts')
    .delete()
    .not('processed_at', 'is', null)
    .lt('processed_at', cutoff)
    .select('id')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, pruned: data?.length ?? 0 })
}
