/**
 * GET /api/dashboard/weekly-stats
 *
 * Returns a rolling 7-day summary of everything the AI Employee did for the
 * authed user's client. Used by the dashboard ROI widget AND by the weekly
 * ROI report skill running on the VPS (same shape, two consumers).
 *
 * Dual auth path:
 *   - Cookie session (authenticated user on the dashboard)
 *   - Bearer agent_api_key (skill running on the VPS)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function resolveClientId(req: NextRequest): Promise<string | null> {
  // 1. Agent bearer path
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  if (m) {
    const supabase = service()
    const { data } = await supabase
      .from('agent_config')
      .select('client_id')
      .eq('agent_api_key', m[1])
      .maybeSingle()
    return data?.client_id ?? null
  }

  // 2. User cookie session path
  const cookieStore = await cookies()
  const sbClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only */ },
      },
    },
  )
  const { data: { user } } = await sbClient.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) ?? null
}

export async function GET(req: NextRequest) {
  const clientId = await resolveClientId(req)
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Date range: last 7 full days (rolling)
  const now = new Date()
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const supabase = service()
  const { data: rows, error } = await supabase
    .from('agent_actions')
    .select('category, value_gbp, minutes_saved, occurred_at, summary')
    .eq('client_id', clientId)
    .gte('occurred_at', windowStart)
    .order('occurred_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to load', detail: error.message }, { status: 500 })
  }

  // Aggregate — full category list, customer-facing + trades-ops
  const ALL_CATEGORIES = [
    'message_handled', 'enquiry_qualified', 'booking_confirmed',
    'booking_rescheduled', 'booking_cancelled', 'quote_sent',
    'quote_chased', 'follow_up_sent', 'review_requested',
    'review_collected', 'escalation_to_owner', 'emergency_handled',
    'research_performed', 'report_delivered', 'admin_task',
    'job_captured', 'variation_logged', 'product_sourced',
    'pipeline_reviewed', 'parts_prepared', 'estimate_drafted',
    'estimate_delivered', 'margin_reconciled',
  ] as const

  const counts: Record<string, number> = {}
  let totalMinutesSaved = 0
  let totalValueGbp = 0
  let totalBookingValue = 0
  const recent: { category: string; summary: string | null; occurred_at: string }[] = []

  for (const r of rows ?? []) {
    counts[r.category] = (counts[r.category] ?? 0) + 1
    totalMinutesSaved += r.minutes_saved ?? 0
    totalValueGbp += Number(r.value_gbp ?? 0)
    if (r.category === 'booking_confirmed') totalBookingValue += Number(r.value_gbp ?? 0)
    if (recent.length < 10) {
      recent.push({
        category: r.category,
        summary: r.summary,
        occurred_at: r.occurred_at,
      })
    }
  }

  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10
  // Conservative UK fully-loaded hourly cost for a part-time receptionist: £15/hr
  const staffCostAvoidedGbp = Math.round(hoursSaved * 15)

  // Emit every known category (zero when absent) so the dashboard UI can
  // render chips consistently and new categories appear as soon as the
  // migration adds them to ALL_CATEGORIES.
  const countsOut: Record<string, number> = {}
  for (const c of ALL_CATEGORIES) countsOut[c] = counts[c] ?? 0
  // Also surface any unexpected categories so the UI sees them even if the
  // list drifts; they'll render as a catch-all.
  for (const k of Object.keys(counts)) {
    if (!(k in countsOut)) countsOut[k] = counts[k]
  }

  return NextResponse.json({
    window_days: 7,
    window_start: windowStart,
    window_end: now.toISOString(),
    totals: {
      actions: rows?.length ?? 0,
      minutes_saved: totalMinutesSaved,
      hours_saved: hoursSaved,
      staff_cost_avoided_gbp: staffCostAvoidedGbp,
      pipeline_value_gbp: Math.round(totalValueGbp),
      booked_value_gbp: Math.round(totalBookingValue),
    },
    counts: countsOut,
    recent,
  })
}
