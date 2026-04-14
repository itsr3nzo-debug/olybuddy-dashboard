import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
const STALE_THRESHOLD_MINUTES = 10 // Alert if no heartbeat in 10 min

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Get all active clients with their latest heartbeat
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug, vps_status, subscription_status')
    .eq('vps_status', 'live')
    .in('subscription_status', ['active', 'trial'])

  if (!clients?.length) {
    return NextResponse.json({ checked: 0, message: 'No live agents' })
  }

  const alerts: string[] = []
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString()

  for (const client of clients) {
    // Get latest heartbeat for this agent
    const { data: heartbeat } = await supabase
      .from('agent_heartbeats')
      .select('agent_slug, timestamp, status, whatsapp_connected, memory_mb')
      .eq('agent_slug', client.slug)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single()

    if (!heartbeat) {
      alerts.push(`🔴 <b>${client.name}</b>: No heartbeat ever received`)
      continue
    }

    // Check staleness
    if (heartbeat.timestamp < staleThreshold) {
      const minutesAgo = Math.round((Date.now() - new Date(heartbeat.timestamp).getTime()) / 60000)
      alerts.push(`🔴 <b>${client.name}</b>: Heartbeat stale (${minutesAgo}min ago)`)
      continue
    }

    // Check status
    if (heartbeat.status === 'critical') {
      alerts.push(`🔴 <b>${client.name}</b>: Status CRITICAL`)
    }

    // Check WhatsApp
    if (!heartbeat.whatsapp_connected) {
      alerts.push(`🟡 <b>${client.name}</b>: WhatsApp disconnected`)
    }

    // Check memory
    if (heartbeat.memory_mb && heartbeat.memory_mb > 3072) {
      alerts.push(`🟡 <b>${client.name}</b>: High memory (${heartbeat.memory_mb}MB)`)
    }
  }

  // Send Telegram alert if any issues found
  if (alerts.length > 0 && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const message = `🏥 <b>Agent Health Check</b>\n\n${alerts.join('\n')}\n\n<i>${clients.length} agents checked | ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}</i>`

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    })
  }

  // Clean old heartbeats (>7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('agent_heartbeats')
    .delete()
    .lt('created_at', sevenDaysAgo)

  return NextResponse.json({
    checked: clients.length,
    alerts: alerts.length,
    issues: alerts,
  })
}
