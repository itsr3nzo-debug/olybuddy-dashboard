/**
 * POST /api/settings/pause-agent
 *
 * Emergency kill switch. When called, flips `agent_config.paused=true` for
 * the authed user's client. Every outbound agent skill checks this flag
 * pre-send and bails if true.
 *
 * Body: { paused: boolean, reason?: string }
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
    userId: user?.id ?? null,
    email: user?.email ?? null,
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

export async function GET() {
  const { clientId } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = service()
  const { data } = await supabase
    .from('agent_config')
    .select('paused, paused_at, paused_reason, paused_by')
    .eq('client_id', clientId).maybeSingle()
  return NextResponse.json({
    paused: data?.paused ?? false,
    paused_at: data?.paused_at ?? null,
    paused_reason: data?.paused_reason ?? null,
    paused_by: data?.paused_by ?? null,
  })
}

export async function POST(req: NextRequest) {
  const { clientId, role, email } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can pause the agent' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body?.paused !== 'boolean') {
    return NextResponse.json({ error: 'paused boolean required' }, { status: 400 })
  }

  const supabase = service()
  const update: Record<string, unknown> = {
    paused: body.paused,
    paused_at: body.paused ? new Date().toISOString() : null,
    paused_reason: body.paused ? (body.reason || 'Paused by owner via dashboard') : null,
    paused_by: body.paused ? (email || 'dashboard') : null,
  }

  const { error } = await supabase
    .from('agent_config').update(update).eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log the action so it appears in the weekly report
  await supabase.from('agent_actions').insert({
    client_id: clientId,
    category: 'admin_task',
    summary: body.paused ? `Agent paused by ${email}` : `Agent unpaused by ${email}`,
    minutes_saved: 0,
    meta: { via: 'dashboard_kill_switch', reason: body.reason ?? null },
  }).then(() => {}, () => {}) // best-effort

  return NextResponse.json({ success: true, paused: body.paused })
}
