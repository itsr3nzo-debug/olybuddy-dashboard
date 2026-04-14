import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  // Auth: require CRON_SECRET
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Find all trial clients where trial_ends_at has passed
  const { data: expiredTrials } = await supabase
    .from('clients')
    .select('id, name, email, trial_ends_at')
    .eq('subscription_status', 'trial')
    .lt('trial_ends_at', new Date().toISOString())

  if (!expiredTrials?.length) {
    return NextResponse.json({ expired: 0 })
  }

  let processed = 0
  for (const client of expiredTrials) {
    // Update status to expired
    await supabase
      .from('clients')
      .update({ subscription_status: 'cancelled' })
      .eq('id', client.id)

    // Deactivate agent
    await supabase
      .from('agent_config')
      .update({ is_active: false, agent_status: 'offline' })
      .eq('client_id', client.id)

    // Send expiry email
    try {
      const { sendSystemEmail } = await import('@/lib/email')
      await sendSystemEmail({
        to: client.email,
        subject: 'Your Nexley AI trial has ended',
        html: `<p>Hi,</p>
          <p>Your 5-day trial for ${client.name} has ended.</p>
          <p>Your AI Employee is now paused. To keep it running, upgrade to a paid plan:</p>
          <p><a href="${process.env.NEXT_PUBLIC_SITE_URL}/login" style="background:#2563EB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Upgrade Now</a></p>
          <p>Your data is safe — we'll keep it for 30 days.</p>
          <p>— The Nexley AI Team</p>`,
      })
    } catch { /* email failure non-fatal */ }

    processed++
  }

  return NextResponse.json({ expired: processed, clients: expiredTrials.map(c => c.name) })
}
