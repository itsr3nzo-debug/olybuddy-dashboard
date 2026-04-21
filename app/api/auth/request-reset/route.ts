import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/request-reset
 * Body: { email: string }
 *
 * Generates a password-reset link via Supabase admin API and emails it to the
 * user via Resend. This bypasses Supabase's built-in mailer and Site URL
 * config entirely — so even if the project's Site URL still points at a dead
 * domain (olybuddy-dashboard), the link we send lands on the correct host.
 *
 * Always returns 200 with a generic message to avoid leaking which emails
 * have accounts (enumeration defence).
 */

const DASHBOARD_ORIGIN = 'https://nexley.vercel.app';
const FROM_ADDRESS = process.env.SMTP_FROM || 'Nexley AI <noreply@nexley.ai>';

export async function POST(req: NextRequest) {
  let email: string | undefined;
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  } catch {
    // fall through
  }
  if (!email) {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Generate the recovery link without firing Supabase's email.
  const { data, error } = await service.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${DASHBOARD_ORIGIN}/reset-password` },
  });

  if (error || !data?.properties?.action_link) {
    // Most common reason: email doesn't have an account. Don't leak.
    console.warn('[request-reset] generateLink:', error?.message, 'email=', email);
    return NextResponse.json({ ok: true });
  }

  // Supabase returns action_link = https://<proj>.supabase.co/auth/v1/verify?
  //   token=<otp>&type=recovery&redirect_to=<...>
  // That hop does two things in order: (a) exchange the token and mint a
  // session, (b) redirect to redirect_to — but (b) enforces the project's
  // redirect-URL allowlist, which is out of date for this project and drops
  // us back to the dead olybuddy-dashboard Site URL.
  //
  // Sidestep the whole hop: pull the `token` and `type`, link the user
  // straight to our own /reset-password, and let the page call verifyOtp()
  // client-side. That relies on no Supabase server-side URL config at all.
  let actionLink = `${DASHBOARD_ORIGIN}/reset-password`;
  try {
    const u = new URL(data.properties.action_link);
    const token = u.searchParams.get('token');
    const type = u.searchParams.get('type') || 'recovery';
    if (token) {
      actionLink = `${DASHBOARD_ORIGIN}/reset-password?token_hash=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}&email=${encodeURIComponent(email)}`;
    }
  } catch {
    /* non-fatal — send the fallback link */
  }

  // Send via Resend (REST API, no SDK dependency).
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('[request-reset] RESEND_API_KEY not set');
    return NextResponse.json({ ok: true });
  }

  const mailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      subject: 'Reset your Nexley password',
      html: renderHtml(actionLink),
      text: renderText(actionLink),
    }),
  });

  if (!mailRes.ok) {
    const body = await mailRes.text();
    console.error('[request-reset] Resend failed:', mailRes.status, body.slice(0, 300));
    // Still return 200 to avoid leaking — the user sees "check your inbox"
    // and we get an alert in the logs.
  }

  return NextResponse.json({ ok: true });
}

function renderText(link: string): string {
  return [
    'Reset your Nexley password',
    '',
    'Someone (hopefully you) asked to reset the password on your Nexley account.',
    'Click the link below to choose a new one. It expires in 1 hour.',
    '',
    link,
    '',
    "If you didn't request this, just ignore this email — nothing will change.",
  ].join('\n');
}

function renderHtml(link: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
  <table width="480" cellpadding="0" cellspacing="0" style="background:#0f1629;border:1px solid rgba(255,255,255,0.08);border-radius:16px;">
    <tr><td style="padding:32px 32px 8px 32px;">
      <div style="font-size:20px;font-weight:600;color:#fff;">Reset your password</div>
    </td></tr>
    <tr><td style="padding:8px 32px 24px 32px;">
      <p style="font-size:14px;line-height:1.55;color:#94a3b8;margin:0 0 18px 0;">Someone asked to reset the password on your Nexley account. Click the button below to choose a new one.</p>
      <a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Set a new password</a>
      <p style="font-size:12px;color:#64748b;margin:20px 0 0 0;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p style="font-size:11px;color:#475569;margin:16px 0 0 0;word-break:break-all;">Or copy and paste this link:<br><span style="color:#64748b;">${link}</span></p>
    </td></tr>
    <tr><td style="padding:20px 32px 28px 32px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:11px;color:#475569;">Sent by Nexley AI · nexley.ai</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
