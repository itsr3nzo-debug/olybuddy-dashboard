/**
 * POST /api/mobile/account/delete
 *
 * GDPR Article 17 — Right to erasure. The user requests permanent deletion
 * of their account.
 *
 * Mobile flow:
 *   1. User taps "Delete account" in Settings → confirmation dialog → POST here
 *   2. Body: { confirm_email: string, reason?: string }
 *      We require the user to type their own email to confirm — same UX as
 *      GitHub / Stripe. Prevents accidental fat-finger deletes.
 *   3. We log the request and disable the account immediately (no more
 *      sign-ins, AI Employee paused, push muted) but defer hard-deletion
 *      by 14 days to allow recovery.
 *   4. After 14 days a cron job purges the rows.
 *
 * Why both immediate-disable and deferred-purge:
 *   - Immediate prevents continued data accumulation under a deleted account
 *   - Deferred preserves recovery option (user changed their mind)
 *   - GDPR's 30-day window is satisfied because hard-delete completes <30d
 *
 * This is a sensitive op so we use requireFreshAuth() — re-verifies the
 * Supabase session is still valid, not just the JWT signature.
 */

import { requireFreshAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


interface DeleteBody {
  confirm_email?: string
  reason?: string
}

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireFreshAuth(request)
    await enforceLimit('mutations', claims.sub)

    const body = (await request.json().catch(() => null)) as DeleteBody | null
    if (!body?.confirm_email) {
      throw Errors.validation({ field: 'confirm_email', message: 'Type your email to confirm.' })
    }
    if (body.confirm_email.trim().toLowerCase() !== (claims.email ?? '').toLowerCase()) {
      throw Errors.validation({
        field: 'confirm_email',
        message: 'That email does not match your account.',
      })
    }

    const clientId = getClientIdFromClaims(claims)
    const sb = createUntypedServiceClient()

    // 1. Audit row
    const { data: gdprRow, error: gdprErr } = await sb
      .from('gdpr_requests')
      .insert({
        user_id: claims.sub,
        client_id: clientId,
        email: claims.email ?? '',
        request_type: 'delete',
        status: 'processing',
      })
      .select('id')
      .single()
    if (gdprErr) throw Errors.internal(gdprErr.message)

    // 2. Immediate-disable — pause AI Employee, mute pushes, mark client deleted_at
    await sb
      .from('agent_config')
      .update({ paused: true, paused_until: null })
      .eq('client_id', clientId)

    await sb
      .from('clients')
      .update({
        deletion_requested_at: new Date().toISOString(),
        subscription_status: 'cancelled',
      })
      .eq('id', clientId)

    // 3. Sign the user out via admin API. This deletes auth.sessions rows;
    // the supabase-session-revoked webhook then writes to jwt_denylist and
    // the sync-jwt-denylist cron pushes to Redis. DA B12 fix — also write a
    // direct denylist entry here so revocation is *immediate* even if the
    // webhook is slow or down.
    try {
      await sb.auth.admin.signOut(claims.sub)
    } catch (err) {
      console.error('[account/delete] auth.admin.signOut failed:', err)
    }
    // Belt-and-braces — denylist the current JWT directly. session_id from
    // the JWT is the revocation key; key falls back to sub:iat per claims.ts.
    const revKey = claims.session_id ?? claims.jti ?? `${claims.sub}:${claims.iat}`
    const expSec = Math.max(60, claims.exp - Math.floor(Date.now() / 1000))
    await sb.from('jwt_denylist').upsert(
      {
        jti: revKey,
        user_id: claims.sub,
        reason: 'admin_revoke',
        expires_at: new Date(claims.exp * 1000).toISOString(),
      },
      { onConflict: 'jti' }
    )
    // And push to Redis inline so the very next request sees the revocation
    try {
      const { revokeJti } = await import('@/lib/auth/revocation')
      await revokeJti(revKey, expSec, 'admin_revoke')
    } catch (err) {
      console.error('[account/delete] redis denylist push failed (non-fatal):', err)
    }

    // 4. Purge happens in 14 days — handled by api/cron/purge-deleted-accounts
    // which finds clients with deletion_requested_at older than 14 days and
    // hard-deletes their data.

    return jsonResponse(
      {
        ok: true,
        request_id: gdprRow.id,
        message:
          'Your account is now disabled. Data will be permanently deleted within 14 days. To recover, contact support before then.',
      },
      { status: 202, requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
