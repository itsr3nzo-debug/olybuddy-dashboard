/**
 * Winback drip emails (item #15). Three steps after cancellation:
 *
 *   step 1 (T+14d) — gentle, "we'd love to know what didn't work" feedback ask
 *   step 2 (T+30d) — feature update + comeback offer
 *   step 3 (T+60d) — final outreach, then drop them
 *
 * Tone: warm, specific to AI Employees, never desperate. The sender is
 * Lorenzo personally (hello@nexley.ai but signed Renzo) — feels less
 * SaaS-spam, more "founder reaching out".
 */

interface WinbackInput {
  businessName: string
  ownerName?: string | null
  reactivateUrl: string
  unsubscribeUrl: string
}

interface WinbackOutput {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function shell(subject: string, intro: string, body: string, ctaText: string, ctaUrl: string, footer: string, unsubscribeUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:28px 32px 0;">
<div style="font-weight:700;font-size:14px;color:#111827;">Nexley AI</div>
<div style="font-size:12px;color:#6b7280;">From Lorenzo</div>
</td></tr>
<tr><td style="padding:18px 32px 8px;">
<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">${intro}</p>
${body}
</td></tr>
<tr><td align="center" style="padding:6px 32px 24px;">
<a href="${ctaUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">${ctaText}</a>
</td></tr>
<tr><td style="padding:14px 32px 24px;border-top:1px solid #f1f2f6;">
<p style="margin:0;font-size:12px;line-height:1.55;color:#9ca3af;">${footer}</p>
<p style="margin:8px 0 0;font-size:11px;color:#9ca3af;"><a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from these emails</a></p>
</td></tr>
</table>
<p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">Nexley AI &middot; <a href="https://nexley.ai" style="color:#9ca3af;text-decoration:underline;">nexley.ai</a></p>
</td></tr></table></body></html>`.trim()
}

export function buildWinbackStep1(input: WinbackInput): WinbackOutput {
  const greeting = input.ownerName ? `Hey ${input.ownerName}` : 'Hey'
  const subject = `Quick question about ${input.businessName}'s AI Employee`
  const intro = `${greeting} — Lorenzo here, founder at Nexley AI.`
  const body = `
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
You cancelled your Nexley AI subscription a couple of weeks ago and I noticed nobody from our side reached out personally. That's on me.
</p>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
I'd really value 30 seconds of your time: <strong>what was the dealbreaker?</strong> Was the AI Employee not booking the right kind of jobs? Was it the £599/mo? Was setup more painful than expected?
</p>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
Just hit reply. Even one line helps me build something better. And if you fancy giving it another shot, I'd happily reactivate your account with the first month at half price.
</p>`
  const text = [
    `${greeting} — Lorenzo here, founder at Nexley AI.`,
    '',
    `You cancelled your Nexley AI subscription a couple of weeks ago and I noticed nobody from our side reached out personally. That's on me.`,
    '',
    `I'd really value 30 seconds of your time: what was the dealbreaker? Reply to this email — even one line helps.`,
    '',
    `If you fancy giving it another shot, I'd happily reactivate your account with the first month at half price.`,
    '',
    `Reactivate: ${input.reactivateUrl}`,
    '',
    `— Renzo`,
    `Nexley AI · nexley.ai`,
  ].join('\n')
  return {
    subject,
    text,
    html: shell(subject, intro, body, 'Reactivate \u2014 50% off first month', input.reactivateUrl,
      '\u2014 Renzo, founder at Nexley AI', input.unsubscribeUrl),
  }
}

export function buildWinbackStep2(input: WinbackInput): WinbackOutput {
  const greeting = input.ownerName ? `${input.ownerName}` : 'Hey'
  const subject = `What's new in Nexley AI since you left`
  const intro = `${greeting} — quick update from Nexley AI.`
  const body = `
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
A month ago you cancelled, which is fine \u2014 not every tool is the right tool. But a lot's shipped since, and I wanted to mention what's actually different now in case any of it changes the calculus:
</p>
<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;line-height:1.7;color:#4b5563;">
<li>Your AI Employee can now connect Gmail, Calendar, and Xero from a one-click integrations tab \u2014 no agency middleman.</li>
<li>Voice calls (ElevenLabs) handle inbound when the human team is asleep, with full call transcripts in your dashboard the next morning.</li>
<li>WhatsApp Business pairing now takes one QR scan \u2014 no more 3-day setup.</li>
</ul>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
If any of this lands, I'll spin your AI Employee back up with the first month at <strong>£0</strong> \u2014 just to remove every reason not to try again.
</p>`
  const text = [
    `${greeting} — quick update from Nexley AI.`,
    '',
    `A month ago you cancelled, which is fine — not every tool is the right tool. But a lot's shipped since:`,
    `- Gmail/Calendar/Xero in one-click integrations`,
    `- ElevenLabs voice for inbound when you're asleep`,
    `- WhatsApp pairing in one QR scan`,
    '',
    `If any of this lands, I'll spin you back up with the first month at £0.`,
    '',
    `Reactivate: ${input.reactivateUrl}`,
    '',
    `— Renzo`,
  ].join('\n')
  return {
    subject,
    text,
    html: shell(subject, intro, body, 'Reactivate \u2014 first month free', input.reactivateUrl,
      '\u2014 Renzo, Nexley AI', input.unsubscribeUrl),
  }
}

export function buildWinbackStep3(input: WinbackInput): WinbackOutput {
  const greeting = input.ownerName ? `${input.ownerName}` : 'Hey'
  const subject = `Last note from Nexley AI`
  const intro = `${greeting} — promise this is the last one.`
  const body = `
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
I won't keep emailing. If you ever want to come back, the door's open and your old setup is preserved \u2014 just hit the link below and you'll be live again same day.
</p>
<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">
And if there's something we did wrong that's worth fixing for the next person, I'd genuinely love to know. Reply to this email \u2014 it goes straight to me.
</p>`
  const text = [
    `${greeting} — promise this is the last one.`,
    '',
    `I won't keep emailing. If you ever want to come back, the door's open — same setup, same data, same VPS.`,
    '',
    `Reactivate: ${input.reactivateUrl}`,
    '',
    `— Renzo`,
  ].join('\n')
  return {
    subject,
    text,
    html: shell(subject, intro, body, 'Reactivate', input.reactivateUrl,
      '\u2014 Renzo, Nexley AI', input.unsubscribeUrl),
  }
}
