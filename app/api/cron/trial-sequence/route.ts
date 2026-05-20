import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { sendSystemEmail } from '@/lib/email';
import {
  renderDay1, renderDay2, renderDay3, renderWinback,
  type TrialContact,
} from '@/lib/trial-email-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/trial-sequence
 *
 * Vercel cron — daily. Drives the 4-touch trial conversion sequence
 * (compressed from 5-touch when trial length was 5 days):
 *   Day 1 → welcome + first-step nudge
 *   Day 2 → "card charged tomorrow" heads-up
 *   Day 3 → "going paid today" last-chance cancellation
 *   Day +10 → winback (post-expiry, if cancelled)
 *
 * Each stage is idempotent via trial_sequence.dayN_sent_at timestamps.
 *
 * Safe-by-default: if the user has upgraded (upgraded_at IS NOT NULL) or
 * the trial has ended + 10 days passed without upgrading, we stop.
 */

const CRON_SECRET = process.env.CRON_SECRET;
const ORIGIN = 'https://nexley.vercel.app';

type Stage = 'day1' | 'day2' | 'day3' | 'winback';

function pickStage(signedUpAt: Date, sent: Record<Stage, boolean>): Stage | null {
  const daysSince = Math.floor((Date.now() - signedUpAt.getTime()) / (24 * 3600 * 1000));
  if (daysSince === 1 && !sent.day1) return 'day1';
  if (daysSince === 2 && !sent.day2) return 'day2';
  if (daysSince === 3 && !sent.day3) return 'day3';
  if (daysSince >= 10 && !sent.winback) return 'winback';
  return null;
}

function renderFor(stage: Stage, c: TrialContact) {
  if (stage === 'day1') return renderDay1(c);
  if (stage === 'day2') return renderDay2(c);
  if (stage === 'day3') return renderDay3(c);
  return renderWinback(c);
}

export async function GET(req: Request) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // All trial users — join with client info for the templates.
  // Note: day2_sent_at column was added 2026-05-20 (3-day trial cadence).
  // The deprecated day4_sent_at / day5_sent_at columns from the old 5-day
  // cadence are intentionally NOT selected; the migration backfilled their
  // values into day2/day3 so legacy rows look the same as new ones.
  const { data: users } = await service
    .from('trial_sequence')
    .select(`
      user_id, client_id, signed_up_at,
      day1_sent_at, day2_sent_at, day3_sent_at, winback_sent_at,
      upgraded_at,
      clients(name, trial_ends_at, contact_name, email)
    `)
    .is('upgraded_at', null);

  let fired = 0;
  const results: Array<{ user_id: string; stage?: Stage; result?: string }> = [];

  for (const u of users ?? []) {
    const c = Array.isArray(u.clients) ? u.clients[0] : u.clients;
    if (!c) continue;
    const contact: TrialContact = {
      name: c.contact_name || 'there',
      business_name: c.name || 'your business',
      dashboard_url: ORIGIN + '/dashboard',
      upgrade_url: ORIGIN + '/api/stripe/upgrade',
      trial_ends_at: c.trial_ends_at ? new Date(c.trial_ends_at) : new Date(Date.now() + 3 * 86400 * 1000),
    };
    const stage = pickStage(new Date(u.signed_up_at), {
      day1: !!u.day1_sent_at,
      day2: !!u.day2_sent_at,
      day3: !!u.day3_sent_at,
      winback: !!u.winback_sent_at,
    });
    if (!stage) continue;

    if (!c.email) {
      results.push({ user_id: u.user_id, stage, result: 'no_email' });
      continue;
    }
    const { subject, html, text } = renderFor(stage, contact);
    const sent = await sendSystemEmail({ to: c.email, subject, html, text });
    if (sent.success) {
      await service.from('trial_sequence').update({ [`${stage}_sent_at`]: new Date().toISOString() }).eq('user_id', u.user_id);
      fired += 1;
      results.push({ user_id: u.user_id, stage, result: 'sent' });
    } else {
      results.push({ user_id: u.user_id, stage, result: `fail:${sent.error}` });
    }
  }

  return NextResponse.json({ ok: true, considered: users?.length ?? 0, fired, results });
}
