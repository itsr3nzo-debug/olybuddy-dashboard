import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { dispatchAgentAlert } from '@/lib/agent-alerts'

/**
 * GET /api/cron/secret-audit
 *
 * Vercel cron — Mon 09:00 UTC. Reads secrets_inventory and flags any
 * secret whose rotation deadline has passed (last_rotated_at +
 * rotation_days < NOW). Sends a single Telegram alert listing all
 * overdue + soon-due (<= 7 days) entries. Anything overdue >30 days
 * also gets enqueued as a P1 task into shared/memory/inbox/light/ via
 * the agent-task table (item #11 — agent-routed alerts).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface SecretRow {
  name: string
  category: string
  severity: string
  rotation_days: number | null
  last_rotated_at: string | null
}

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: rows } = await supabase
    .from('secrets_inventory')
    .select('name, category, severity, rotation_days, last_rotated_at')
    .not('rotation_days', 'is', null)

  if (!rows?.length) {
    return NextResponse.json({ ok: true, audited: 0 })
  }

  const now = Date.now()
  const overdue: Array<SecretRow & { days_overdue: number }> = []
  const soon: Array<SecretRow & { days_until: number }> = []

  for (const r of rows as SecretRow[]) {
    if (!r.rotation_days) continue
    const last = r.last_rotated_at ? new Date(r.last_rotated_at).getTime() : 0
    const due = last + r.rotation_days * 24 * 60 * 60 * 1000
    const diffDays = Math.floor((due - now) / (24 * 60 * 60 * 1000))
    if (diffDays < 0) overdue.push({ ...r, days_overdue: -diffDays })
    else if (diffDays <= 7) soon.push({ ...r, days_until: diffDays })
  }

  // Item #11 — route through Light. He'll pick the right agent (Itachi
  // for infra secrets, Senku for outreach keys, etc) and either auto-rotate
  // or surface to Renzo. No Telegram fallback needed for P2/P3 — Light
  // owns the pacing.
  const critical = overdue.filter(r => r.days_overdue > 30 || r.severity === 'critical')
  const totalFlags = overdue.length + soon.length

  if (totalFlags > 0) {
    const lines: string[] = []
    if (overdue.length) {
      lines.push(`**Overdue (${overdue.length}):**`)
      for (const r of overdue) lines.push(`- ${r.name} \u2014 ${r.days_overdue}d overdue (${r.severity})`)
    }
    if (soon.length) {
      lines.push('', `**Due within 7 days (${soon.length}):**`)
      for (const r of soon) lines.push(`- ${r.name} \u2014 ${r.days_until}d (${r.severity})`)
    }
    lines.push('', 'Runbook: `docs/operations/SECRET-ROTATION-RUNBOOK.md`. Update last_rotated_at in secrets_inventory after each rotation.')

    await dispatchAgentAlert({
      target: 'light',
      // Severely-overdue critical secrets are P0 — wake-the-house. Otherwise
      // P2 weekly housekeeping.
      priority: critical.some(c => c.days_overdue > 30) ? 'P0' : 'P2',
      category: 'secret_rotation',
      subject: `${overdue.length} overdue + ${soon.length} due-soon secrets`,
      body: lines.join('\n'),
      source: 'cron:secret-audit',
      meta: { overdue, soon, critical },
    })
  }

  return NextResponse.json({
    ok: true,
    audited: rows.length,
    overdue: overdue.length,
    soon: soon.length,
    critical_routed_to_agents: critical.length,
  })
}
