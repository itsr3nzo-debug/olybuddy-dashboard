import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailToken } from '@/lib/auth/email-verification'

/**
 * GET /api/auth/verify-email?token={raw}&id={client_id}
 *
 * Public endpoint hit when the user clicks the link in their verification
 * email. Validates the token against the SHA-256 hash stored in the clients
 * row, marks email_verified_at on success, then redirects back to the
 * dashboard with a banner.
 *
 * URL is intentionally NOT POST — email clients can't fire POSTs from a link
 * click and we want one-click verification. CSRF isn't a concern because the
 * action is idempotent (verifying the same email twice is fine) and the
 * token itself is the auth credential.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const rawToken = url.searchParams.get('token') || ''
  const clientId = url.searchParams.get('id') || ''
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`

  if (!rawToken || !clientId) {
    return NextResponse.redirect(`${siteUrl}/login?verify=missing`, { status: 302 })
  }

  const result = await verifyEmailToken({ clientId, rawToken })
  if (!result.ok) {
    const reason = encodeURIComponent(result.error || 'invalid')
    return NextResponse.redirect(`${siteUrl}/login?verify=failed&reason=${reason}`, { status: 302 })
  }

  // Success — push them back into the app. If they're already signed in
  // (most likely, since the verification email was sent right after signup
  // and they have a session cookie) the proxy lands them on /dashboard.
  // If not, /login picks up ?verify=ok and shows a "verified — sign in" toast.
  const dest = result.alreadyVerified
    ? `${siteUrl}/dashboard?verify=already`
    : `${siteUrl}/dashboard?verify=ok`
  return NextResponse.redirect(dest, { status: 302 })
}
