import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { sendSystemEmail } from '@/lib/email';
import {
  renderDay1, renderDay3, renderDay4, renderDay5Morning, renderWinback,
  type TrialContact,
} from '@/lib/trial-email-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/trial-sequence
 *
 * Vercel cron — daily. Drives the 5-touch trial conversion sequence:
 *   Day 1 → first-step nudge
 *   Day 3 → "connect Gmail" unlock
 *   Day 4 → "1 day left, 20% off" upgrade CTA
 *   Day 5 → "last call" morning
 *   Day +7 → winback (post-expiry)
 *
 * Each stage is idempotent via trial_sequence.dayN_sent_at timestamps.
 *
 * Safe-by-default: if the user has upgraded (upgraded_at IS NOT NULL) or
 * the trial has ended + 7 days passed without upgrading, we stop.
 */

const CRON_SECRET = process.env.CRON_SECRET;
const ORIGIN = 'https://nexley.vercel.app';

type Stage = 'day1' | 'day3' | 'day4' | 'day5' | 'winback';

function pickStage(signedUpAt: Date, sent: Record<Stage, boolean>): Stage | null {
  const daysSince = Math.floor((Date.now() - signedUpAt.getTime()) / (24 * 3600 * 1000));
  if (daysSince === 1 && !sent.day1) return 'day1';
  if (daysSince === 3 && !sent.day3) return 'day3';
  if (daysSince === 4 && !sent.day4) return 'day4';
  if (daysSince === 5 && !sent.day5) return 'day5';
  if (daysSince >= 12 && !sent.winback) return 'winback';
  return null;
}

function renderFor(stage: Stage, c: TrialContact) {
  if (stage === 'day1') return renderDay1(c);
  if (stage === 'day3') return renderDay3(c);
  if (stage === 'day4') return renderDay4(c);
  if (stage === 'day5') return renderDay5Morning(c);
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

  // All trial users — join with client info for the templates
  const { data: users } = await service
    .from('trial_sequence')
    .select(`
      user_id, client_id, signed_up_at,
      day1_sent_at, day3_sent_at, day4_sent_at, day5_sent_at, winback_sent_at,
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
      trial_ends_at: c.trial_ends_at ? new Date(c.trial_ends_at) : new Date(Date.now() + 5 * 86400 * 1000),
    };
    const stage = pickStage(new Date(u.signed_up_at), {
      day1: !!u.day1_sent_at,
      day3: !!u.day3_sent_at,
      day4: !!u.day4_sent_at,
      day5: !!u.day5_sent_at,
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
