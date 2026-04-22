/**
 * GET /api/dashboard/trial-stats
 *
 * Returns a per-day breakdown of agent_actions for the last 5 days (or since
 * trial_started_at if available on the clients row). Used by the TrialROICard
 * to show the 5-day trial scorecard with time-saved and money-saved stats.
 *
 * Same dual-auth pattern as /api/dashboard/weekly-stats:
 *   - Cookie session (dashboard user)
 *   - Bearer agent_api_key (VPS skill)
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

  const supabase = service()

  // Try to get trial_started_at from clients table
  const { data: clientRow } = await supabase
    .from('clients')
    .select('trial_started_at, subscription_plan, created_at')
    .eq('id', clientId)
    .maybeSingle()

  // Window: 5 days from trial start, or just the last 5 days
  const trialStart = clientRow?.trial_started_at
    ? new Date(clientRow.trial_started_at)
    : clientRow?.created_at
      ? new Date(clientRow.created_at)
      : new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)

  const now = new Date()
  // Cap window to 5 days from trial start, but no further than now
  const windowStart = trialStart
  const windowEnd = new Date(Math.min(
    trialStart.getTime() + 5 * 24 * 60 * 60 * 1000,
    now.getTime(),
  ))

  const { data: rows, error } = await supabase
    .from('agent_actions')
    .select('category, value_gbp, minutes_saved, occurred_at, summary')
    .eq('client_id', clientId)
    .gte('occurred_at', windowStart.toISOString())
    .lte('occurred_at', windowEnd.toISOString())
    .order('occurred_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to load', detail: error.message }, { status: 500 })
  }

  // Build 5-day buckets from trial start
  const days: {
    date: string          // ISO date string YYYY-MM-DD
    label: string         // e.g. "Day 1", "Day 2"
    dayOfWeek: string     // e.g. "Mon"
    actions: number
    minutes_saved: number
    value_gbp: number
    categories: Record<string, number>
  }[] = []

  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const daysElapsed = Math.max(1, Math.ceil((windowEnd.getTime() - windowStart.getTime()) / MS_PER_DAY))
  const totalDays = Math.min(5, daysElapsed)

  for (let i = 0; i < totalDays; i++) {
    const dayStart = new Date(windowStart.getTime() + i * MS_PER_DAY)
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)
    const dateStr = dayStart.toISOString().slice(0, 10)
    const dayLabel = `Day ${i + 1}`
    const dayOfWeek = dayStart.toLocaleDateString('en-GB', { weekday: 'short' })

    const dayRows = (rows ?? []).filter(r => {
      const t = new Date(r.occurred_at).getTime()
      return t >= dayStart.getTime() && t < dayEnd.getTime()
    })

    const categories: Record<string, number> = {}
    let minutesSaved = 0
    let valueGbp = 0
    for (const r of dayRows) {
      categories[r.category] = (categories[r.category] ?? 0) + 1
      minutesSaved += r.minutes_saved ?? 0
      valueGbp += Number(r.value_gbp ?? 0)
    }

    days.push({
      date: dateStr,
      label: dayLabel,
      dayOfWeek,
      actions: dayRows.length,
      minutes_saved: minutesSaved,
      value_gbp: Math.round(valueGbp),
      categories,
    })
  }

  // Totals across the 5-day window
  const allRows = rows ?? []
  const totalActions = allRows.length
  const totalMinutesSaved = allRows.reduce((sum, r) => sum + (r.minutes_saved ?? 0), 0)
  const totalValueGbp = allRows.reduce((sum, r) => sum + Number(r.value_gbp ?? 0), 0)
  const totalBookingValue = allRows
    .filter(r => r.category === 'booking_confirmed')
    .reduce((sum, r) => sum + Number(r.value_gbp ?? 0), 0)

  const hoursSaved = Math.round((totalMinutesSaved / 60) * 10) / 10
  const staffCostAvoided = Math.round(hoursSaved * 15) // £15/hr receptionist baseline

  return NextResponse.json({
    trial_started_at: windowStart.toISOString(),
    window_days: totalDays,
    subscription_plan: clientRow?.subscription_plan ?? 'trial',
    days,
    totals: {
      actions: totalActions,
      minutes_saved: totalMinutesSaved,
      hours_saved: hoursSaved,
      staff_cost_avoided_gbp: staffCostAvoided,
      pipeline_value_gbp: Math.round(totalValueGbp),
      booked_value_gbp: Math.round(totalBookingValue),
    },
  })
}
