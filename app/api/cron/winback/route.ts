import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendSystemEmail } from '@/lib/email'
import { buildWinbackStep1, buildWinbackStep2, buildWinbackStep3 } from '@/lib/email-templates/winback'
import { dispatchAgentAlert } from '@/lib/agent-alerts'

/**
 * GET /api/cron/winback
 *
 * Vercel cron — daily 11:00 UTC. Drives the winback drip (item #15).
 *
 * Looks for winback_sequence rows where:
 *   - reactivated_at IS NULL  (they haven't come back)
 *   - unsubscribed_at IS NULL (they haven't opted out)
 * and the relevant step is due:
 *   - step1: cancelled_at + 14d AND step1_sent_at IS NULL
 *   - step2: step1_sent_at + 16d (so total ~30d) AND step2_sent_at IS NULL
 *   - step3: step2_sent_at + 30d (so total ~60d) AND step3_sent_at IS NULL
 *
 * Marks each row's step{N}_sent_at on success. Failures (SMTP outage)
 * leave the column NULL so the next run picks it up.
 *
 * After step 3, no more emails. Light gets a P3 housekeeping ping with the
 * full list of "you can drop these from your CRM now".
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexley.vercel.app'

interface WinbackRow {
  id: string
  client_id: string
  email: string
  cancelled_at: string
  step1_sent_at: string | null
  step2_sent_at: string | null
  step3_sent_at: string | null
}

const STEP1_DAYS = 14
const STEP2_DAYS = 16   // T+30d total
const STEP3_DAYS = 30   // T+60d total

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOwnerName(supabase: any, clientId: string): Promise<{ name: string | null; ownerName: string | null }> {
  const { data } = await supabase
    .from('clients')
    .select('name, contact_name')
    .eq('id', clientId)
    .single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  return { name: row?.name ?? null, ownerName: row?.contact_name ?? null }
}

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const stats = { step1: 0, step2: 0, step3: 0, failed: 0 }
  const finished: Array<{ id: string; email: string }> = []

  // ───── Step 1 — T+14d ─────────────────────────────────────────────────
  const { data: step1Rows } = await supabase
    .from('winback_sequence')
    .select('id, client_id, email, cancelled_at, step1_sent_at, step2_sent_at, step3_sent_at')
    .is('step1_sent_at', null)
    .is('reactivated_at', null)
    .is('unsubscribed_at', null)
    .lt('cancelled_at', daysAgo(STEP1_DAYS))
    .limit(50)

  for (const r of (step1Rows || []) as WinbackRow[]) {
    const owner = await loadOwnerName(supabase, r.client_id)
    const unsubscribeUrl = `${SITE_URL}/api/winback/unsubscribe?id=${r.id}`
    const reactivateUrl = `${SITE_URL}/login?return=/settings/billing`
    const msg = buildWinbackStep1({
      businessName: owner.name || 'your business',
      ownerName: owner.ownerName,
      reactivateUrl,
      unsubscribeUrl,
    })
    const result = await sendSystemEmail({ to: r.email, subject: msg.subject, html: msg.html, text: msg.text })
    if (result.success) {
      await supabase
        .from('winback_sequence')
        .update({ step1_sent_at: new Date().toISOString() })
        .eq('id', r.id)
      stats.step1++
    } else {
      stats.failed++
    }
  }

  // ───── Step 2 — step1 + 16d ─────────────────────────────────────────────
  const { data: step2Rows } = await supabase
    .from('winback_sequence')
    .select('id, client_id, email, cancelled_at, step1_sent_at, step2_sent_at, step3_sent_at')
    .not('step1_sent_at', 'is', null)
    .is('step2_sent_at', null)
    .is('reactivated_at', null)
    .is('unsubscribed_at', null)
    .lt('step1_sent_at', daysAgo(STEP2_DAYS))
    .limit(50)

  for (const r of (step2Rows || []) as WinbackRow[]) {
    const owner = await loadOwnerName(supabase, r.client_id)
    const unsubscribeUrl = `${SITE_URL}/api/winback/unsubscribe?id=${r.id}`
    const reactivateUrl = `${SITE_URL}/login?return=/settings/billing`
    const msg = buildWinbackStep2({
      businessName: owner.name || 'your business',
      ownerName: owner.ownerName,
      reactivateUrl,
      unsubscribeUrl,
    })
    const result = await sendSystemEmail({ to: r.email, subject: msg.subject, html: msg.html, text: msg.text })
    if (result.success) {
      await supabase
        .from('winback_sequence')
        .update({ step2_sent_at: new Date().toISOString() })
        .eq('id', r.id)
      stats.step2++
    } else {
      stats.failed++
    }
  }

  // ───── Step 3 — step2 + 30d (so T+60d total) ────────────────────────────
  const { data: step3Rows } = await supabase
    .from('winback_sequence')
    .select('id, client_id, email, cancelled_at, step1_sent_at, step2_sent_at, step3_sent_at')
    .not('step2_sent_at', 'is', null)
    .is('step3_sent_at', null)
    .is('reactivated_at', null)
    .is('unsubscribed_at', null)
    .lt('step2_sent_at', daysAgo(STEP3_DAYS))
    .limit(50)

  for (const r of (step3Rows || []) as WinbackRow[]) {
    const owner = await loadOwnerName(supabase, r.client_id)
    const unsubscribeUrl = `${SITE_URL}/api/winback/unsubscribe?id=${r.id}`
    const reactivateUrl = `${SITE_URL}/login?return=/settings/billing`
    const msg = buildWinbackStep3({
      businessName: owner.name || 'your business',
      ownerName: owner.ownerName,
      reactivateUrl,
      unsubscribeUrl,
    })
    const result = await sendSystemEmail({ to: r.email, subject: msg.subject, html: msg.html, text: msg.text })
    if (result.success) {
      await supabase
        .from('winback_sequence')
        .update({ step3_sent_at: new Date().toISOString() })
        .eq('id', r.id)
      stats.step3++
      finished.push({ id: r.client_id, email: r.email })
    } else {
      stats.failed++
    }
  }

  // P3 — let Light know which sequences finished today (he can drop them
  // from any active CRM lists; if any responded with intent he should
  // mark winback_sequence.reactivated_at).
  if (finished.length > 0) {
    await dispatchAgentAlert({
      target: 'light',
      priority: 'P3',
      category: 'winback_complete',
      subject: `${finished.length} winback sequence${finished.length === 1 ? '' : 's'} finished`,
      body: [
        'These customers received the final winback email today and won\u2019t be emailed again unless they re-engage:',
        '',
        ...finished.map(f => `- ${f.email}`),
        '',
        'Drop them from any active CRM follow-up lists.',
      ].join('\n'),
      source: 'cron:winback',
      meta: { finished },
    })
  }

  return NextResponse.json({ ok: true, ...stats })
}
