import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/csp-report
 *
 * CSP violation report endpoint. Logs violations to integration_signals
 * so we can tighten the policy before flipping enforce mode.
 *
 * Devil's-advocate round 2 hardening:
 *   - Per-IP rate limit (10/min) so a hostile actor can't bloat the
 *     integration_signals table with garbage POSTs.
 *   - Body shape validation — must contain at least one expected CSP
 *     report field. Random JSON gets dropped silently.
 *   - Per-(directive, uri) dedup over a 1-hour window — same violation
 *     from 1000 page-loads = 1 row, not 1000.
 *
 * Browser sends Content-Type: application/csp-report (legacy) or
 * application/reports+json (newer Reporting API).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const RATE_LIMIT_PER_MIN = 10
const DEDUP_WINDOW_MS = 60 * 60 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkRateLimit(ip: string, supabase: any): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60 * 1000).toISOString()
  const { count } = await supabase
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', `csp-report:${ip}`)
    .gte('created_at', windowStart)
  return (count ?? 0) < RATE_LIMIT_PER_MIN
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordHit(ip: string, supabase: any) {
  await supabase.from('rate_limit_events').insert({ key: `csp-report:${ip}` })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function looksLikeCspReport(report: any): boolean {
  if (!report || typeof report !== 'object') return false
  // Legacy 'csp-report' shape OR new Reporting API shape.
  return (
    'violated-directive' in report
    || 'violatedDirective' in report
    || 'effectiveDirective' in report
    || 'effective-directive' in report
    || 'blocked-uri' in report
    || 'blockedURL' in report
  )
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    if (!raw) return NextResponse.json({ ok: true })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    // Rate limit before any DB write or parsing — cheap defense first.
    if (!(await checkRateLimit(ip, supabase))) {
      return NextResponse.json({ ok: true, throttled: true })
    }
    await recordHit(ip, supabase)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any
    try {
      payload = JSON.parse(raw)
    } catch {
      return NextResponse.json({ ok: true })
    }

    // Both legacy ('csp-report' wrapper) and Reporting API ('body') shapes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = payload['csp-report']
      || (Array.isArray(payload) ? payload[0]?.body : payload?.body)
      || payload

    // Validate the body actually looks like a CSP report. Random POSTs
    // with valid JSON but no CSP fields get dropped here.
    if (!looksLikeCspReport(report)) {
      return NextResponse.json({ ok: true, dropped: 'not_csp_shape' })
    }

    const directive = report['violated-directive']
      || report.violatedDirective
      || report.effectiveDirective
      || report['effective-directive']
      || 'unknown'
    const blocked = report['blocked-uri']
      || report.blockedURL
      || 'unknown'
    const externalId = `${directive}::${blocked}`

    // Round-3 fix: dedup that preserves hit_count. Previously we
    // checked existence and silently dropped duplicates — meaning the
    // SLO dashboard couldn't tell "1 user hit this once" from "1000
    // users hit this 100 times each". Now: find the most recent row
    // for this (directive, uri) in the dedup window; if it exists,
    // bump its hit_count; otherwise insert fresh with hit_count=1.
    const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
    const { data: existing } = await supabase
      .from('integration_signals')
      .select('id, raw')
      .eq('source', 'csp')
      .eq('kind', 'violation')
      .eq('external_id', externalId)
      .gte('occurred_at', dedupSince)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ex = existing as any
      const prevCount = Number(ex?.raw?.hit_count) || 1
      await supabase
        .from('integration_signals')
        .update({
          // Merge hit_count into raw so historical rows aren't lost.
          raw: { ...(ex.raw || {}), hit_count: prevCount + 1, last_seen_at: new Date().toISOString() },
        })
        .eq('id', ex.id)
      return NextResponse.json({ ok: true, deduped: true, hit_count: prevCount + 1 })
    }

    await supabase.from('integration_signals').insert({
      source: 'csp',
      kind: 'violation',
      external_id: externalId,
      raw: { ...report, hit_count: 1, first_seen_at: new Date().toISOString() },
      occurred_at: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[csp-report]', e)
    return NextResponse.json({ ok: true }) // never fail the browser
  }
}

export async function GET() {
  return NextResponse.json({ error: 'POST only' }, { status: 405 })
}
