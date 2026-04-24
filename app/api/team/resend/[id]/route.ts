import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabase } from '@/lib/supabase'
import { getUserSession, hasPermission } from '@/lib/rbac'
import { buildTeamInviteEmail } from '@/lib/email-templates/team-invite'

/**
 * POST /api/team/resend/[id]
 *
 * Regenerate a magic link for a pending member and re-send the invite
 * email. Used when the original invite was lost, expired, or never
 * delivered. Same ownership rules as the DELETE endpoint:
 *   - caller has `invite_members` permission
 *   - target shares the caller's `client_id`
 *   - target is still `role: 'member'` (resending to an owner is a no-op)
 *
 * Returns the fresh action_link alongside `success: true` so the UI can
 * offer a copy-to-clipboard fallback when SMTP silently fails.
 */
export async function POST(
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

  const adminSupabase = getSupabase()

  const { data: target } = await adminSupabase.auth.admin.getUserById(targetUserId)
  if (!target.user || !target.user.email) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const targetClientId = (target.user.app_metadata?.client_id as string | undefined) ?? null
  const targetRole = (target.user.app_metadata?.role as string | undefined) ?? 'member'
  if (targetClientId !== session.clientId) {
    return NextResponse.json({ error: 'Not on your team' }, { status: 403 })
  }
  if (targetRole !== 'member') {
    return NextResponse.json(
      { error: 'Only pending member invites can be resent' },
      { status: 400 },
    )
  }

  const { data: linkData, error: linkErr } =
    await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: target.user.email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      },
    })

  if (linkErr || !linkData.properties?.action_link) {
    return NextResponse.json(
      { error: 'Failed to generate invite link' },
      { status: 500 },
    )
  }

  // Fetch inviter + client display name for the email body.
  const { data: clientRow } = await adminSupabase
    .from('clients')
    .select('name')
    .eq('id', session.clientId)
    .maybeSingle()
  const clientName = (clientRow as { name?: string } | null)?.name ?? 'your team'
  const inviterName = user.email ?? 'A teammate'

  let emailSent = true
  try {
    const { sendSystemEmail } = await import('@/lib/email')
    const { subject, html, text } = buildTeamInviteEmail({
      clientName,
      inviterName,
      actionLink: linkData.properties.action_link,
      resend: true,
    })
    await sendSystemEmail({ to: target.user.email, subject, html, text })
  } catch {
    emailSent = false
  }

  return NextResponse.json({
    success: true,
    email: target.user.email,
    emailSent,
    // Fallback — owner can copy/paste if SMTP fails
    inviteUrl: linkData.properties.action_link,
  })
}
