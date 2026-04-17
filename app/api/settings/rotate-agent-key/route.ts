/**
 * POST /api/settings/rotate-agent-key
 *
 * Rotate the client's agent_api_key. Generates a new `oak_...` key, updates
 * agent_config, enqueues a provisioning_queue row so the worker pushes the
 * new key into the VPS /.env via apply-sender-roles.
 *
 * The old key stays valid until the worker runs. During the window (typically
 * <60s), both keys work. After, old key returns 401.
 *
 * Only owners + super_admins can rotate.
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
    email: user?.email ?? null,
  }
}

export async function POST(req: NextRequest) {
  const { clientId, role, email } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can rotate keys' }, { status: 403 })
  }

  // Generate a new oak_ key (same shape as signup)
  const newKey = 'oak_' + randomBytes(24).toString('hex')

  const supabase = service()

  // Update agent_config
  const { error: updErr } = await supabase
    .from('agent_config')
    .update({ agent_api_key: newKey })
    .eq('client_id', clientId)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Enqueue provisioning — the worker will push the new key to the VPS .env
  await supabase.from('provisioning_queue').insert({
    client_id: clientId,
    action: 'apply_sender_roles',
    triggered_by: 'dashboard:rotate-agent-key',
    meta: { rotated_by: email, rotated_at: new Date().toISOString() },
  }).then(() => {}, () => {})

  // Log the rotation
  await supabase.from('agent_actions').insert({
    client_id: clientId,
    category: 'admin_task',
    summary: `Agent API key rotated by ${email}`,
    minutes_saved: 0,
    meta: { action: 'key_rotation' },
  }).then(() => {}, () => {})

  return NextResponse.json({
    success: true,
    new_key_prefix: newKey.slice(0, 12) + '...',  // never expose the full key in response
    queued: true,
    note: 'Worker will push the new key to your AI Employee within 30-60 seconds.',
  })
}
