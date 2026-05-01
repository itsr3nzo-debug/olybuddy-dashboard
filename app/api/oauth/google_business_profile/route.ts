/**
 * Google Business Profile OAuth handler.
 *
 * Composio doesn't have GBP. We run our own OAuth against Google with the
 * `business.manage` sensitive scope. While the OAuth consent screen is in
 * "Testing" status, only allowlisted Gmail addresses can connect, and
 * refresh tokens expire every 7 days. Once verification clears, those
 * limits go away.
 *
 * Listing-age gate: Google requires the GBP listing to be verified ≥60 days
 * before the API will work against it. We can't enforce this client-side,
 * but if the API rejects with 403/PERMISSION_DENIED on first call after OAuth,
 * we flip the integration to status='blocked_external' and surface
 * `expected_ready_at` on the dashboard.
 *
 * Env required:
 *   GOOGLE_GBP_CLIENT_ID
 *   GOOGLE_GBP_CLIENT_SECRET
 *   (a separate OAuth client from the GOOGLE_CLIENT_ID used for Gmail/Calendar,
 *    so we don't burn the verified Gmail app while iterating on GBP review.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GBP_SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
].join(' ')

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const role = user.app_metadata?.role ?? 'member'
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.redirect(new URL('/integrations?error=unauthorized', req.url))
  }

  const clientId = user.app_metadata?.client_id
  if (!clientId) {
    return NextResponse.redirect(new URL('/integrations?error=no_client_id', req.url))
  }

  const gbpClientId = process.env.GOOGLE_GBP_CLIENT_ID
  if (!gbpClientId) {
    return NextResponse.redirect(
      new URL('/integrations?error=not_configured&provider=google_business_profile', req.url),
    )
  }

  const state = randomBytes(32).toString('hex')
  const redirectUri = `${origin}/api/oauth/google_business_profile/callback`

  const authParams = new URLSearchParams({
    client_id: gbpClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_SCOPES,
    state,
    access_type: 'offline',
    prompt: 'consent',           // force consent every time so we always get a refresh_token
    include_granted_scopes: 'true',
  })

  const response = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${authParams.toString()}`)
  response.cookies.set('oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  response.cookies.set('oauth_provider', 'google_business_profile', {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  return response
}
