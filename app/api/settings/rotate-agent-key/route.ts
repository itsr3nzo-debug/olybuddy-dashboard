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
import { hashAgentKey } from '@/lib/agent-auth'

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

  const supabase = service()

  // Round-3 fix #3: gate key rotation on email verification. Rotating
  // the agent API key is a sensitive action — a stolen-session attacker
  // could rotate to lock the legitimate owner out of their VPS. Allow
  // override via ?force=true for emergency rotations (round-3 fix #14)
  // — the override IS audited so misuse is traceable.
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  // super_admin can always rotate (ops needs to recover compromised keys
  // even when the customer's mailbox is unreachable).
  if (!force && role !== 'super_admin') {
    const { data: clientRow } = await supabase
      .from('clients')
      .select('email_verified_at')
      .eq('id', clientId)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = clientRow as any
    if (!c?.email_verified_at) {
      return NextResponse.json(
        {
          error: 'Verify your email before rotating your agent API key. The verification link is in your inbox.',
          code: 'email_not_verified',
        },
        { status: 403 }
      )
    }
  }
  if (force) {
    // Audit the override regardless of whether it's used.
    await supabase.from('agent_actions').insert({
      client_id: clientId,
      category: 'admin_task',
      summary: `Force-rotate override used by ${email || 'unknown'} (role=${role})`,
      minutes_saved: 0,
      meta: { action: 'key_rotation_force_override', role, email },
    }).then(() => {}, () => {})
  }

  // Generate a new oak_ key (same shape as signup). Hash-at-rest: only the
  // SHA-256 lives in agent_config; the raw key rides through the
  // provisioning_queue.meta row to the VPS .env, then the worker deletes
  // the row. Item #4 + P1 #4 fix.
  const newKey = 'oak_' + randomBytes(24).toString('hex')
  const newKeyHash = hashAgentKey(newKey)

  // Read the current hash so we can park it in previous_api_key_hash with
  // a 5-minute TTL — covers the window where the VPS still has the OLD
  // key in its .env until the worker pushes the new one.
  //
  // Round-2 fix #4: abort if there's an active previous_api_key_expires_at
  // in the future. That means a rotation is already in flight — running
  // a second one within the TTL would clobber the first rotation's
  // "previous" pointer, and the original-original key (which the VPS
  // may still be using) would be locked out.
  const { data: existing } = await supabase
    .from('agent_config')
    .select('agent_api_key_hash, agent_api_key, previous_api_key_expires_at')
    .eq('client_id', clientId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = existing as any
  if (
    !force
    && ex?.previous_api_key_expires_at
    && new Date(ex.previous_api_key_expires_at).getTime() > Date.now()
  ) {
    const minutesLeft = Math.ceil((new Date(ex.previous_api_key_expires_at).getTime() - Date.now()) / 60000)
    return NextResponse.json(
      {
        error: `A key rotation is already in progress. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}, or pass ?force=true if this is an emergency rotation.`,
        code: 'rotation_in_progress',
      },
      { status: 409 }
    )
  }
  const previousHash =
    ex?.agent_api_key_hash
      ?? (ex?.agent_api_key ? hashAgentKey(ex.agent_api_key) : null)

  const previousExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  // Update agent_config — write new hash, park old as previous, null
  // the legacy plaintext column so a leaked DB snapshot can't grant
  // future access.
  const { error: updErr } = await supabase
    .from('agent_config')
    .update({
      agent_api_key_hash: newKeyHash,
      previous_api_key_hash: previousHash,
      previous_api_key_expires_at: previousHash ? previousExpiresAt : null,
      agent_api_key: null,
    })
    .eq('client_id', clientId)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Enqueue provisioning — the worker will push the new key to the VPS .env.
  await supabase.from('provisioning_queue').insert({
    client_id: clientId,
    action: 'apply_sender_roles',
    triggered_by: 'dashboard:rotate-agent-key',
    meta: {
      rotated_by: email,
      rotated_at: new Date().toISOString(),
      agent_api_key: newKey,
    },
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
