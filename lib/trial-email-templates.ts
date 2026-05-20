/**
 * Email templates for the 3-day trial conversion sequence.
 * Short, direct, UK tone — matches the Nexley brand voice (see USER.md).
 *
 * Each render function returns { subject, html, text }. The cron driver
 * (app/api/cron/trial-sequence/route.ts) picks one based on day-N.
 *
 * 2026-05-20: compressed from 5-touch (Day 1/3/4/5/winback) to 4-touch
 * (Day 1/2/3/winback) to match the new 3-day trial. The previous
 * renderDay3 ("connect Gmail" nudge) was retired — its messaging assumed
 * "2 days left" mid-trial, which doesn't exist in a 3-day window.
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

/** Day 1 — welcome + 2-minute first-step nudge. */
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
<p>While you're there, connect Gmail or Outlook from the Integrations tab so the agent can follow up by email too — 30 seconds, no code.</p>
${footer()}`,
    text: `Hey ${c.name.split(' ')[0]},\n\nYour ${c.business_name} AI Employee is live.\n\n2-min test: text the business WhatsApp number, ask "What does ${c.business_name} do?", watch the reply.\n\nDashboard: ${c.dashboard_url}\nIntegrations (Gmail/Outlook): ${c.dashboard_url}/integrations`,
  };
}

/** Day 2 — heads-up: card will be auto-charged tomorrow. */
export function renderDay2(c: TrialContact) {
  // UK formatted trial-end date: "Tuesday, 29 April"
  const endDate = c.trial_ends_at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    subject: `Heads up — your card will be charged £599 tomorrow`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Your 3-day trial ends ${endDate}. Tomorrow morning your card on file will be auto-charged £599 for your first month, and your ${c.business_name} AI Employee stays live without interruption.</p>
<p><strong>Happy with it so far?</strong> Do nothing — billing just happens.</p>
<p><strong>Want to stop?</strong> You can cancel in two clicks from your dashboard, no awkward conversation required:</p>
<p><a href="${c.dashboard_url}/settings/billing" style="display:inline-block;background:#64748b;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Manage subscription</a></p>
<p>Or reply to this email if something's not working — we'd rather fix it than lose you.</p>
${footer()}`,
    text: `Your card will be auto-charged £599 tomorrow for month 1. Happy? Do nothing. Want to stop? Cancel in two clicks: ${c.dashboard_url}/settings/billing`,
  };
}

/** Day 3 — going-paid-today / last-chance cancellation. */
export function renderDay3(c: TrialContact) {
  return {
    subject: `Your AI Employee is going paid today — £599 will be charged`,
    html: `<p>Hey ${c.name.split(' ')[0]},</p>
<p>Today's the day your 3-day trial ends. Your card will be auto-charged £599 for your first month. Your ${c.business_name} AI Employee stays live and keeps answering every call and WhatsApp.</p>
<p>Last chance to cancel without being charged:</p>
<p><a href="${c.dashboard_url}/settings/billing" style="display:inline-block;background:#64748b;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Cancel subscription</a></p>
<p>If this is working for you — thanks. We'll never send a nag email again; you're officially one of us.</p>
${footer()}`,
    text: `Trial ends today. £599 will be auto-charged for month 1. Cancel here if you want to stop: ${c.dashboard_url}/settings/billing`,
  };
}

/** Winback — fires 10+ days after trial start if the customer cancelled. */
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
