import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Supabase service role client — bypasses RLS
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key)
}

// Format seconds → "X m Y s"
function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// Compute weekly stats for a client
function computeStats(calls: CallRow[]) {
  const total = calls.length
  const answered = calls.filter(c => c.status === 'completed').length
  const missed = calls.filter(c => c.status === 'no_answer' || c.status === 'failed').length
  const durations = calls.filter(c => c.duration_seconds).map(c => c.duration_seconds!)
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0
  const uniqueCallers = new Set(calls.map(c => c.from_number).filter(Boolean)).size
  return { total, answered, missed, avgDuration, uniqueCallers }
}

// Build HTML email body
function buildEmailHtml(clientName: string, stats: ReturnType<typeof computeStats>, weekStr: string): string {
  const answerRate = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Weekly AI Employee Report</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <!-- Header -->
        <tr>
          <td style="background:#0f172a;padding:32px 40px;">
            <p style="margin:0;color:#94a3b8;font-size:12px;letter-spacing:.05em;text-transform:uppercase;">Olybuddy</p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:700;">Your Weekly AI Employee Report</h1>
            <p style="margin:6px 0 0;color:#64748b;font-size:14px;">${weekStr}</p>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <p style="margin:0;color:#374151;font-size:16px;line-height:1.6;">
              Hi ${clientName},<br><br>
              Here's what your AI Employee handled this week while you focused on the work.
            </p>
          </td>
        </tr>
        <!-- Stats grid -->
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding-right:8px;padding-bottom:12px;">
                  <div style="background:#f0f9ff;border-radius:8px;padding:20px;">
                    <p style="margin:0;font-size:32px;font-weight:700;color:#0ea5e9;">${stats.total}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#0369a1;">Calls handled</p>
                  </div>
                </td>
                <td width="50%" style="padding-left:8px;padding-bottom:12px;">
                  <div style="background:#f0fdf4;border-radius:8px;padding:20px;">
                    <p style="margin:0;font-size:32px;font-weight:700;color:#16a34a;">${stats.answered}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#15803d;">Answered (${answerRate}%)</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding-right:8px;">
                  <div style="background:#fefce8;border-radius:8px;padding:20px;">
                    <p style="margin:0;font-size:32px;font-weight:700;color:#ca8a04;">${stats.uniqueCallers}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#a16207;">Unique callers</p>
                  </div>
                </td>
                <td width="50%" style="padding-left:8px;">
                  <div style="background:#faf5ff;border-radius:8px;padding:20px;">
                    <p style="margin:0;font-size:32px;font-weight:700;color:#9333ea;">${formatDuration(stats.avgDuration)}</p>
                    <p style="margin:4px 0 0;font-size:13px;color:#7e22ce;">Avg call duration</p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${stats.missed > 0 ? `
        <!-- Missed calls notice -->
        <tr>
          <td style="padding:0 40px 24px;">
            <div style="background:#fef2f2;border-left:3px solid #ef4444;border-radius:4px;padding:14px 16px;">
              <p style="margin:0;color:#dc2626;font-size:14px;">
                <strong>${stats.missed} call${stats.missed === 1 ? '' : 's'} missed</strong> — your AI Employee will follow up automatically.
              </p>
            </div>
          </td>
        </tr>` : ''}
        <!-- CTA -->
        <tr>
          <td style="padding:0 40px 32px;">
            <a href="https://olybuddy-dashboard.vercel.app" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
              View full dashboard →
            </a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
              You're receiving this because your AI Employee is managed by Olybuddy.<br>
              Questions? Reply to this email or message us on WhatsApp.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// Send email via Resend REST API
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Olybuddy <reports@olybuddy.com>',
      to: [to],
      subject,
      html,
    }),
  })
  return res.ok
}

// Send Telegram notification to Renzo
async function notifyTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  })
}

interface ClientRow {
  id: string
  name: string
  email: string | null
  subscription_status: string
}

interface CallRow {
  status: string
  duration_seconds: number | null
  from_number: string | null
}

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or manually with the secret)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()
  const now = new Date()
  const weekAgo = new Date(now)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const weekStr = `${weekAgo.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  // Fetch all active/trial clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name, email, subscription_status')
    .in('subscription_status', ['active', 'trial'])

  if (clientsError) {
    console.error('Failed to fetch clients:', clientsError)
    return NextResponse.json({ error: clientsError.message }, { status: 500 })
  }

  const results: Array<{ client: string; email: string | null; sent: boolean; calls: number }> = []

  for (const client of (clients as ClientRow[] ?? [])) {
    const { data: calls } = await supabase
      .from('call_logs')
      .select('status, duration_seconds, from_number')
      .eq('client_id', client.id)
      .gte('started_at', weekAgo.toISOString())

    const stats = computeStats((calls ?? []) as CallRow[])
    const html = buildEmailHtml(client.name, stats, weekStr)
    const subject = `Your AI Employee report: ${stats.total} call${stats.total === 1 ? '' : 's'} this week`

    let sent = false
    if (client.email) {
      sent = await sendEmail(client.email, subject, html)
    }

    results.push({ client: client.name, email: client.email, sent, calls: stats.total })
  }

  // Telegram summary to Renzo
  const totalClients = results.length
  const emailsSent = results.filter(r => r.sent).length
  const noEmail = results.filter(r => !r.email).length
  const summary = results.map(r =>
    `• ${r.client}: ${r.calls} calls${r.sent ? ' ✓' : r.email ? ' ✗' : ' (no email)'}`
  ).join('\n')

  await notifyTelegram(
    `<b>Weekly Report — ${weekStr}</b>\n\nSent to ${emailsSent}/${totalClients} clients (${noEmail} have no email).\n\n${summary}`
  )

  return NextResponse.json({
    ok: true,
    week: weekStr,
    clients: totalClients,
    emailsSent,
    results,
  })
}
