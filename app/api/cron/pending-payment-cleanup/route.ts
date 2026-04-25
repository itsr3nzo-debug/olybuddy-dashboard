import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchAgentAlert } from '@/lib/agent-alerts'

/**
 * GET /api/cron/pending-payment-cleanup
 *
 * Vercel cron — daily. Deletes clients rows stuck in 'pending_payment' state
 * for >24 hours (Stripe Checkout sessions expire after 24h — if the webhook
 * never fires by then, the customer either:
 *   (a) abandoned the tab and will never come back
 *   (b) had a real failure we couldn't recover from
 *
 * Either way, the row is dead weight — provision-poller won't match it
 * (gate: subscription_status IN trial/active), trial-expiry won't email
 * them ("your trial ended" would be wrong — they never paid), and admin
 * views get cluttered.
 *
 * Deletes:
 *   - clients row
 *   - agent_config row (cascade via client_id)
 *   - trial_sequence row
 *   - provisioning_queue row
 *   - Supabase auth user (so they can retry the same email tomorrow)
 *
 * Alerts Telegram with a count of cleaned rows. Idempotent — safe to run
 * multiple times.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Find pending_payment rows older than 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: stuck } = await supabase
    .from('clients')
    .select('id, email, name, created_at')
    .eq('subscription_status', 'pending_payment')
    .lt('created_at', cutoff)

  if (!stuck?.length) {
    return NextResponse.json({ cleaned: 0 })
  }

  const authUserIds: string[] = []
  for (const client of stuck) {
    // 1. Find + collect the auth user ID for this client's email
    try {
      const { data: userList } = await supabase.auth.admin.listUsers({ perPage: 200 })
      const match = userList?.users?.find(u => u.email === client.email)
      if (match) authUserIds.push(match.id)
    } catch { /* best-effort */ }

    // 2. Delete related rows
    await supabase.from('agent_config').delete().eq('client_id', client.id)
    await supabase.from('provisioning_queue').delete().eq('client_id', client.id)
    await supabase.from('trial_sequence').delete().eq('client_id', client.id)
    await supabase.from('clients').delete().eq('id', client.id)
  }

  // 3. Delete auth users (separate API call per user)
  for (const uid of authUserIds) {
    try {
      await supabase.auth.admin.deleteUser(uid)
    } catch { /* best-effort */ }
  }

  // 4. Route the cleanup summary through Light (item #11) — he'll decide
  // whether the abandoned-signup count is high enough to warrant looking
  // at the funnel (e.g. >5 in one cycle = something broken upstream).
  await dispatchAgentAlert({
    target: 'senku',
    priority: stuck.length >= 5 ? 'P1' : 'P3',
    category: 'signup_funnel',
    subject: `Pending-payment cleanup: removed ${stuck.length} stuck row${stuck.length === 1 ? '' : 's'}`,
    body: [
      `Daily cleanup of stuck Stripe Checkouts >24h old.`,
      ``,
      `**Removed:**`,
      ...stuck.map(c => `- ${c.name} (${c.email}) \u2014 ${Math.floor((Date.now() - new Date(c.created_at).getTime()) / 3600000)}h old`),
      ``,
      stuck.length >= 5
        ? `Volume is high \u2014 worth checking signup-to-paid conversion in the last 24h. Possible Stripe outage, broken webhook, or pricing-page issue.`
        : `Normal background drop-off rate.`,
    ].join('\n'),
    source: 'cron:pending-payment-cleanup',
    meta: { stuck, authUserIds },
  })

  return NextResponse.json({
    cleaned: stuck.length,
    auth_users_deleted: authUserIds.length,
    rows: stuck.map(c => ({ id: c.id, email: c.email, age_hours: Math.floor((Date.now() - new Date(c.created_at).getTime()) / 3600000) })),
  })
}
