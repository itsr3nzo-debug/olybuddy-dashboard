import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { sendSystemEmail } from '@/lib/email';

export const runtime = 'nodejs';

/**
 * POST /api/auth/request-reset
 * Body: { email: string }
 *
 * Generates a password-reset link via Supabase admin API and emails it to the
 * user via Resend. This bypasses Supabase's built-in mailer and Site URL
 * config entirely — so even if the project's Site URL still points at a dead
 * domain (pre-rebrand), the link we send lands on the correct host.
 *
 * Always returns 200 with a generic message to avoid leaking which emails
 * have accounts (enumeration defence).
 */

const DASHBOARD_ORIGIN = 'https://nexley.vercel.app';
const REPLY_TO = process.env.SMTP_REPLY_TO || 'hello@nexley.ai';

// Per-email rate limit. In-memory (resets on cold start, good enough for the
// dashboard's small footprint). If we later run multiple serverless instances,
// move to Redis / Supabase. 3 requests per 15 min per email; 10 per IP per 15 min.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;
const emailHits = new Map<string, number[]>();
const ipHits = new Map<string, number[]>();
function hit(store: Map<string, number[]>, key: string, cap: number): boolean {
  const now = Date.now();
  const arr = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= cap) { store.set(key, arr); return false; }
  arr.push(now);
  store.set(key, arr);
  return true;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  // IP-level cap first (per-IP, even before we see the email — defends against
  // enumeration with many random emails from one source).
  if (!hit(ipHits, ip, MAX_PER_IP)) {
    return NextResponse.json({ ok: true }); // silent — don't leak rate-limit state
  }

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

  // Per-email cap — silent pass-through on over-cap, same 200 as success to
  // avoid leaking existence or rate state.
  if (!hit(emailHits, email, MAX_PER_EMAIL)) {
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
  // us back to the dead pre-rebrand Site URL.
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

  // Primary: Gmail SMTP via nodemailer (branded sender).
  const sent = await sendSystemEmail({
    to: email,
    subject: 'Reset your Nexley password',
    html: renderHtml(actionLink),
    text: renderText(actionLink),
    replyTo: REPLY_TO,
  });
  if (sent.success) {
    return NextResponse.json({ ok: true });
  }

  // Fallback: fire Supabase's built-in recovery email. Delivery works but the
  // link in the email honours the project's Site URL — if that's still the
  // dead pre-rebrand origin, the user's click lands on a 404. This is
  // purely a "better than nothing" path while SMTP/Resend creds are fixed.
  console.error('[request-reset] SMTP send failed — falling back to Supabase mailer:', sent.error);
  await service.auth.resetPasswordForEmail(email, {
    redirectTo: `${DASHBOARD_ORIGIN}/reset-password`,
  }).catch((e) => console.error('[request-reset] Supabase fallback also failed:', e));

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
