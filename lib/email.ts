/** System email sender — uses Gmail SMTP via Nodemailer
 * For Olybuddy → client emails (weekly reports, onboarding, billing)
 * NOT for client AI Employee → customer emails (that uses client OAuth)
 */

import nodemailer from 'nodemailer'

const SMTP_HOST = process.env.SMTP_HOST ?? 'smtp.gmail.com'
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587')
const SMTP_USER = process.env.SMTP_USER ?? 'hello@olybuddy.com'
const SMTP_PASS = process.env.SMTP_PASS // App Password or regular password
const SMTP_FROM = process.env.SMTP_FROM ?? 'Olybuddy <hello@olybuddy.com>'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!SMTP_PASS) {
      throw new Error('SMTP_PASS not configured — set it in env vars')
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  }
  return transporter
}

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
}

export async function sendSystemEmail(options: SendEmailOptions): Promise<{
  success: boolean
  messageId?: string
  error?: string
}> {
  try {
    const transport = getTransporter()

    const result = await transport.sendMail({
      from: SMTP_FROM,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo ?? SMTP_USER,
    })

    return { success: true, messageId: result.messageId }
  } catch (e) {
    console.error('System email send failed:', e)
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Unknown email error',
    }
  }
}

/** Build the weekly report HTML email
 * NOTE: Currently unused — the cron route builds its own HTML inline.
 * This is available for future use if we migrate the report template here.
 */
export function buildWeeklyReportHtml(data: {
  businessName: string
  totalCalls: number
  answeredCalls: number
  missedCalls: number
  avgDuration: string
  uniqueCallers: number
  moneySaved: string
  dashboardUrl: string
}): string {
  const answerRate = data.totalCalls > 0
    ? Math.round((data.answeredCalls / data.totalCalls) * 100)
    : 0

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;background:#6366f1;border-radius:12px;display:flex;align-items:center;justify-content:center;">
          <span style="color:white;font-size:18px;">📞</span>
        </div>
        <span style="color:white;font-size:24px;font-weight:700;">Olybuddy</span>
      </div>
    </div>

    <!-- Card -->
    <div style="background:#1e293b;border-radius:16px;padding:32px;border:1px solid #334155;">
      <h1 style="color:white;font-size:20px;margin:0 0 4px;">Weekly Report</h1>
      <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">${data.businessName} · Last 7 days</p>

      <!-- Hero stat -->
      <div style="background:linear-gradient(135deg,#166534,#16a34a);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
        <p style="color:#bbf7d0;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Money Saved</p>
        <p style="color:white;font-size:36px;font-weight:700;margin:0;">${data.moneySaved}</p>
      </div>

      <!-- Stats grid -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:12px;background:#0f172a;border-radius:8px;text-align:center;width:50%;">
            <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;">Calls Handled</p>
            <p style="color:white;font-size:24px;font-weight:700;margin:0;">${data.totalCalls}</p>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#0f172a;border-radius:8px;text-align:center;width:50%;">
            <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;">Answer Rate</p>
            <p style="color:${answerRate >= 90 ? '#4ade80' : answerRate >= 70 ? '#fbbf24' : '#f87171'};font-size:24px;font-weight:700;margin:0;">${answerRate}%</p>
          </td>
        </tr>
        <tr><td colspan="3" style="height:8px;"></td></tr>
        <tr>
          <td style="padding:12px;background:#0f172a;border-radius:8px;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;">Unique Callers</p>
            <p style="color:white;font-size:24px;font-weight:700;margin:0;">${data.uniqueCallers}</p>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#0f172a;border-radius:8px;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;">Avg Duration</p>
            <p style="color:white;font-size:24px;font-weight:700;margin:0;">${data.avgDuration}</p>
          </td>
        </tr>
      </table>

      ${data.missedCalls > 0 ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:24px;">
        <p style="color:#dc2626;font-size:13px;margin:0;"><strong>${data.missedCalls} missed call${data.missedCalls > 1 ? 's' : ''}</strong> this week. Your AI Employee is working on follow-ups.</p>
      </div>
      ` : ''}

      <!-- CTA -->
      <a href="${data.dashboardUrl}" style="display:block;background:#6366f1;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
        View Full Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <p style="color:#64748b;font-size:11px;text-align:center;margin-top:24px;">
      Olybuddy AI Employee · You're receiving this because your AI is active.<br>
      <a href="${data.dashboardUrl}/settings" style="color:#64748b;">Manage notification preferences</a>
    </p>
  </div>
</body>
</html>`
}
