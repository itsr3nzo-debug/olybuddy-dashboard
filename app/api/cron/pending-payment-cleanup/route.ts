import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

  // 4. Telegram alert with the cleanup summary
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (botToken && chatId) {
      const msg = `🧹 pending-payment cleanup: removed ${stuck.length} row${stuck.length === 1 ? '' : 's'} + ${authUserIds.length} auth user${authUserIds.length === 1 ? '' : 's'}\n` +
                  stuck.map(c => `  · ${c.name} (${c.email})`).join('\n')
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      })
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    cleaned: stuck.length,
    auth_users_deleted: authUserIds.length,
    rows: stuck.map(c => ({ id: c.id, email: c.email, age_hours: Math.floor((Date.now() - new Date(c.created_at).getTime()) / 3600000) })),
  })
}
