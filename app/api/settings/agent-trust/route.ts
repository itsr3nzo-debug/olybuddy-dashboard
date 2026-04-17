/**
 * GET  /api/settings/agent-trust — returns current trust_level + thresholds for the caller's client
 * POST /api/settings/agent-trust — owner/super_admin-only; updates trust settings and enqueues a
 *                                  provisioning job so the VPS agent re-reads its business.md
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

async function getSession() {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return {
    user,
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

export async function GET() {
  const { clientId } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = service()
  const { data, error } = await supabase
    .from('agent_config')
    .select(
      'trust_level, auto_send_threshold_gbp, auto_send_max_booking_minutes, auto_send_first_time_customer, trust_level_changed_at, trust_level_changed_by',
    )
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    trust_level: data?.trust_level ?? 2,
    auto_send_threshold_gbp: data?.auto_send_threshold_gbp ?? 100,
    auto_send_max_booking_minutes: data?.auto_send_max_booking_minutes ?? 60,
    auto_send_first_time_customer: data?.auto_send_first_time_customer ?? false,
    trust_level_changed_at: data?.trust_level_changed_at ?? null,
    trust_level_changed_by: data?.trust_level_changed_by ?? null,
  })
}

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can change agent trust settings' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const {
    trust_level,
    auto_send_threshold_gbp,
    auto_send_max_booking_minutes,
    auto_send_first_time_customer,
  } = body

  // Validate
  if (![0, 1, 2, 3].includes(trust_level)) {
    return NextResponse.json({ error: 'trust_level must be 0, 1, 2, or 3' }, { status: 400 })
  }
  if (typeof auto_send_threshold_gbp !== 'number' || auto_send_threshold_gbp < 0 || auto_send_threshold_gbp > 10000) {
    return NextResponse.json({ error: 'auto_send_threshold_gbp must be 0-10000' }, { status: 400 })
  }
  if (typeof auto_send_max_booking_minutes !== 'number' || auto_send_max_booking_minutes < 5 || auto_send_max_booking_minutes > 480) {
    return NextResponse.json({ error: 'auto_send_max_booking_minutes must be 5-480' }, { status: 400 })
  }
  if (typeof auto_send_first_time_customer !== 'boolean') {
    return NextResponse.json({ error: 'auto_send_first_time_customer must be true/false' }, { status: 400 })
  }

  const supabase = service()

  // Update agent_config
  const updateResult = await supabase
    .from('agent_config')
    .update({
      trust_level,
      auto_send_threshold_gbp,
      auto_send_max_booking_minutes,
      auto_send_first_time_customer,
      trust_level_changed_at: new Date().toISOString(),
      trust_level_changed_by: user?.email ?? 'unknown',
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', clientId)

  if (updateResult.error) {
    return NextResponse.json({ error: updateResult.error.message }, { status: 500 })
  }

  // Enqueue a provisioning job so the worker pushes the new business.md to the VPS
  await supabase.from('provisioning_queue').insert({
    client_id: clientId,
    action: 'apply_trust_settings',
    status: 'pending',
    triggered_by: 'dashboard:agent-trust',
    meta: {
      trust_level,
      auto_send_threshold_gbp,
      auto_send_max_booking_minutes,
      auto_send_first_time_customer,
    },
  }).then(() => {}, () => {
    /* non-fatal — agent will read the updated values from Supabase on next startup regardless */
  })

  // Audit
  await supabase.from('agent_actions').insert({
    client_id: clientId,
    category: 'admin_task',
    summary: `Trust level set to ${trust_level}; threshold £${auto_send_threshold_gbp}; booking cap ${auto_send_max_booking_minutes}min; first-time auto-send ${auto_send_first_time_customer ? 'ON' : 'OFF'}`,
    minutes_saved: 0,
    skill_used: 'trust-routing:config',
    outcome_tag: 'n_a',
    meta: {
      trust_level,
      auto_send_threshold_gbp,
      auto_send_max_booking_minutes,
      auto_send_first_time_customer,
      changed_by: user?.email,
    },
  }).then(() => {}, () => {})

  return NextResponse.json({
    trust_level,
    auto_send_threshold_gbp,
    auto_send_max_booking_minutes,
    auto_send_first_time_customer,
    trust_level_changed_at: new Date().toISOString(),
    trust_level_changed_by: user?.email ?? null,
  })
}
