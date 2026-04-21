/**
 * Email templates for the 5-day trial conversion sequence.
 * Short, direct, UK tone — matches the Nexley brand voice (see USER.md).
 *
 * Each render function returns { subject, html, text }. The cron driver
 * (app/api/cron/trial-sequence/route.ts) picks one based on day-N.
 */

export interface TrialContact {
  name: string;
  business_name: string;
  dashboard_url: string;
  upgrade_url: string;
  trial_ends_at: Date;
}

function footer() {
  return '<p style="color:#64748b;font-size:11px;margin-top:24px;">Nexley AI · nexley.ai · Stop receiving trial emails: <a href="https://nexley.ai/unsubscribe" style="color:#64748b;">unsubscribe</a></p>';
}

export function renderDay1(c: TrialContact) {
  return {
    subject: `${c.name.split(' ')[0]}, your AI Employee is ready — 2-min first step`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Your ${c.business_name} AI Employee is live. Most people don't realise how much it can do on day one — here's a 2-minute test:</p>
<ol>
  <li>Text the agent's business WhatsApp number yourself</li>
  <li>Ask: <em>"What does ${c.business_name} do?"</em></li>
  <li>Watch the reply land in your pocket</li>
</ol>
<p>That's it — you just saw what every customer will see from now on. <a href="${c.dashboard_url}">Open your dashboard</a> to watch it in real time.</p>
${footer()}`,
    text: `Hey ${c.name.split(' ')[0]},\n\nYour ${c.business_name} AI Employee is live.\n\n2-min test: text the business WhatsApp number, ask "What does ${c.business_name} do?", watch the reply.\n\nDashboard: ${c.dashboard_url}`,
  };
}

export function renderDay3(c: TrialContact) {
  return {
    subject: `${c.name.split(' ')[0]}, connect Gmail to unlock automatic follow-ups`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Your agent is answering WhatsApp — nice. The next unlock is <strong>follow-ups by email</strong>, which turns every enquiry into either a booking or a clear "no, thanks."</p>
<p><a href="${c.dashboard_url}/integrations" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Connect Gmail</a></p>
<p>Takes 30 seconds. No code. You're still on trial — 2 days left.</p>
${footer()}`,
    text: `${c.name.split(' ')[0]}, connect Gmail at ${c.dashboard_url}/integrations to unlock automatic follow-ups. 30 seconds. 2 days of trial left.`,
  };
}

export function renderDay4(c: TrialContact) {
  return {
    subject: `1 day left on your Nexley trial — 20% off first month`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Trial ends tomorrow. To keep your agent live without a break:</p>
<p><a href="${c.upgrade_url}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Upgrade with 20% off first month</a></p>
<p>Use code <strong>TRIAL20</strong> at checkout.</p>
<p>Prefer to cancel? No awkward calls — just reply to this email.</p>
${footer()}`,
    text: `Trial ends tomorrow. Upgrade with 20% off: ${c.upgrade_url} (code TRIAL20). Prefer to cancel? Just reply to this email.`,
  };
}

export function renderDay5Morning(c: TrialContact) {
  return {
    subject: `Last call — trial ends today at 5pm`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Trial ends 5pm today. After that your agent pauses — customer messages queue but aren't answered.</p>
<p><a href="${c.upgrade_url}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Stay live — upgrade now</a></p>
<p>Code <strong>TRIAL20</strong> still works until 5pm.</p>
${footer()}`,
    text: `Trial ends 5pm today. Upgrade: ${c.upgrade_url} (code TRIAL20 until 5pm).`,
  };
}

export function renderWinback(c: TrialContact) {
  return {
    subject: `We paused your AI — open invite to come back`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Your ${c.business_name} AI Employee has been paused for a week. No hard feelings — we know timing doesn't always work.</p>
<p>If you want to un-pause, your old data is still there:</p>
<p><a href="${c.upgrade_url}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Reactivate</a></p>
<p>Or reply and tell us what was missing — we read every one.</p>
${footer()}`,
    text: `Hey ${c.name.split(' ')[0]}, your AI is paused. Want to un-pause? ${c.upgrade_url}. Or reply and tell us what was missing.`,
  };
}
