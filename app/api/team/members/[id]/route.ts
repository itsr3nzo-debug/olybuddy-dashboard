import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabase } from '@/lib/supabase'
import { getUserSession, hasPermission } from '@/lib/rbac'

/**
 * DELETE /api/team/members/[id]
 *
 * Remove a member from this client's team. Four safety gates:
 *   1. Caller must be authenticated and hold the `invite_members`
 *      permission (owner or super_admin — not members themselves).
 *   2. Target user's `client_id` must match the caller's `client_id`.
 *      Prevents a compromised owner-A JWT from deleting owner-B users.
 *   3. Caller cannot delete themselves. Would leave an account orphaned.
 *   4. Caller cannot delete a super_admin. Only Nexley team can remove
 *      fellow team members (that flow lives outside this endpoint).
 *
 * Hard-delete via `auth.admin.deleteUser` — this invalidates tokens,
 * drops from auth.users, and our FK cascade kills the public.users row.
 * The chosen path is fine for the common case (invitee never onboarded
 * or is leaving); if anyone ever wants soft-delete + audit later, the
 * place to add it is here.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: targetUserId } = await params
  if (!targetUserId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll() {},
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const session = getUserSession(user)
  if (!hasPermission(session.role, 'invite_members')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!session.clientId) {
    return NextResponse.json({ error: 'No client_id' }, { status: 400 })
  }
  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: 'You can\u2019t remove yourself from the team here.' },
      { status: 400 },
    )
  }

  const adminSupabase = getSupabase()

  // Load the target to enforce client_id ownership + super_admin safety.
  const { data: target } = await adminSupabase.auth.admin.getUserById(targetUserId)
  if (!target.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const targetClientId = (target.user.app_metadata?.client_id as string | undefined) ?? null
  const targetRole = (target.user.app_metadata?.role as string | undefined) ?? 'member'
  if (targetClientId !== session.clientId) {
    return NextResponse.json(
      { error: 'This user is not on your team' },
      { status: 403 },
    )
  }
  if (targetRole === 'super_admin') {
    return NextResponse.json(
      { error: 'Super-admin users can\u2019t be removed from here.' },
      { status: 403 },
    )
  }

  const { error } = await adminSupabase.auth.admin.deleteUser(targetUserId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: targetUserId })
}

/**
 * PATCH /api/team/members/[id]
 *
 * Change a team member's role (member ↔ owner). Same safety gates as
 * DELETE — caller must hold `invite_members`, target must be on the
 * same client, caller can't change their own role (the
 * "accidentally demote myself to member and lose settings access"
 * footgun), and super_admin is immutable from this endpoint.
 *
 * Promoting a member to owner gives them: settings, billing,
 * integrations, invite-members, money, and agent-logs. A second owner
 * is the normal pattern for co-founders.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: targetUserId } = await params
  if (!targetUserId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll() {},
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const session = getUserSession(user)
  if (!hasPermission(session.role, 'invite_members')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!session.clientId) {
    return NextResponse.json({ error: 'No client_id' }, { status: 400 })
  }
  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: 'You can\u2019t change your own role here.' },
      { status: 400 },
    )
  }

  let body: { role?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const newRole = body.role
  if (newRole !== 'member' && newRole !== 'owner') {
    return NextResponse.json(
      { error: 'Role must be "member" or "owner"' },
      { status: 400 },
    )
  }

  const adminSupabase = getSupabase()

  // Load target to enforce client_id + super_admin gates.
  const { data: target } = await adminSupabase.auth.admin.getUserById(targetUserId)
  if (!target.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const targetClientId = (target.user.app_metadata?.client_id as string | undefined) ?? null
  const targetRole = (target.user.app_metadata?.role as string | undefined) ?? 'member'
  if (targetClientId !== session.clientId) {
    return NextResponse.json(
      { error: 'This user is not on your team' },
      { status: 403 },
    )
  }
  if (targetRole === 'super_admin') {
    return NextResponse.json(
      { error: 'Super-admin users can\u2019t be modified from here.' },
      { status: 403 },
    )
  }
  if (targetRole === newRole) {
    // No-op is fine; return success so the UI stays simple.
    return NextResponse.json({ success: true, id: targetUserId, role: newRole })
  }

  // Merge into existing app_metadata rather than replacing — we'd
  // otherwise clobber client_id and leave the user orphaned.
  const currentMeta = target.user.app_metadata ?? {}
  const { error } = await adminSupabase.auth.admin.updateUserById(targetUserId, {
    app_metadata: { ...currentMeta, role: newRole },
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: targetUserId, role: newRole })
}
