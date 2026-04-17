/**
 * GET  /api/settings/inbound-webhook       — returns webhook URL + masked token + trust_level
 * POST /api/settings/inbound-webhook/rotate — rotates the webhook_token (returns new full token ONCE)
 * PATCH /api/settings/inbound-webhook      — update trust_level
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'

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
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

export async function GET() {
  const { clientId } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = service()
  const [{ data: cfg }, { data: client }] = await Promise.all([
    supabase.from('agent_config').select('webhook_token, trust_level').eq('client_id', clientId).maybeSingle(),
    supabase.from('clients').select('slug').eq('id', clientId).maybeSingle(),
  ])

  const token = cfg?.webhook_token as string | undefined
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://olybuddy-dashboard.vercel.app'

  return NextResponse.json({
    webhook_url: client ? `${siteUrl}/api/clients/${client.slug}/webhook` : null,
    token_masked: token ? `${token.slice(0, 8)}...${token.slice(-4)}` : null,
    has_token: !!token,
    trust_level: cfg?.trust_level ?? 1,
  })
}

export async function POST() {
  // Rotate token. Returns the full new token ONCE.
  const { clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can rotate' }, { status: 403 })
  }

  const newToken = 'whk_' + randomBytes(24).toString('hex')
  const supabase = service()
  const { error } = await supabase
    .from('agent_config')
    .update({ webhook_token: newToken })
    .eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log the rotation for auditability
  await supabase.from('agent_actions').insert({
    client_id: clientId,
    category: 'admin_task',
    summary: 'Inbound webhook token rotated',
    minutes_saved: 0,
    meta: { action: 'webhook_token_rotation' },
  }).then(() => {}, () => {})

  return NextResponse.json({
    success: true,
    token: newToken,
    note: 'Save this token now — it will not be shown again. Rotate again if lost.',
  })
}

export async function PATCH(req: NextRequest) {
  const { clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can change trust level' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const level = body?.trust_level
  if (typeof level !== 'number' || level < 0 || level > 3) {
    return NextResponse.json({ error: 'trust_level must be 0-3' }, { status: 400 })
  }

  const supabase = service()
  const { error } = await supabase
    .from('agent_config')
    .update({ trust_level: level })
    .eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, trust_level: level })
}
