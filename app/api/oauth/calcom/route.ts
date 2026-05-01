/**
 * Cal.com OAuth handler — initiates OAuth 2.1 against Cal.com.
 *
 * Composio doesn't have a Cal.com toolkit (verified Apr 2026), so we run our
 * own OAuth flow and store the refresh token in integrations.refresh_token_enc.
 *
 * Cal.com OAuth endpoints (verified against cal.com/docs/api-reference/v2/oauth):
 *   authorize: https://app.cal.com/auth/oauth2/authorize
 *   token:     https://api.cal.com/v2/auth/oauth2/token
 *   userinfo:  https://api.cal.com/v2/me   (Bearer access_token)
 *   scopes:    RESOURCE_ACTION pairs (BOOKING_READ, BOOKING_WRITE, etc.).
 *              Legacy names like READ_BOOKING are deprecated and treat the
 *              client as a "legacy" client with reduced privileges.
 *
 * Confidential client (we have a CLIENT_SECRET): we authenticate with
 * client_secret. Cal.com docs say PKCE and client_secret are mutually
 * exclusive — pick one. We pick client_secret because the dashboard is
 * server-side and can hold the secret safely.
 *
 * Env required:
 *   CALCOM_CLIENT_ID
 *   CALCOM_CLIENT_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'crypto'

const CALCOM_AUTH_URL = 'https://app.cal.com/auth/oauth2/authorize'
const SCOPES = [
  'BOOKING_READ',
  'BOOKING_WRITE',
  'EVENT_TYPE_READ',
  'EVENT_TYPE_WRITE',
  'SCHEDULE_READ',
  'PROFILE_READ',
].join(' ')

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll() {},
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const role = user.app_metadata?.role ?? 'member'
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.redirect(new URL('/integrations?error=unauthorized', req.url))
  }

  const clientId = user.app_metadata?.client_id
  if (!clientId) {
    return NextResponse.redirect(new URL('/integrations?error=no_client_id', req.url))
  }

  const calcomClientId = process.env.CALCOM_CLIENT_ID
  if (!calcomClientId) {
    return NextResponse.redirect(
      new URL('/integrations?error=not_configured&provider=calcom', req.url),
    )
  }

  // CSRF state only — confidential client, so client_secret is used at the
  // token-exchange step instead of PKCE.
  const state = randomBytes(32).toString('hex')
  const redirectUri = `${origin}/api/oauth/calcom/callback`

  const authParams = new URLSearchParams({
    client_id: calcomClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  })

  const response = NextResponse.redirect(`${CALCOM_AUTH_URL}?${authParams.toString()}`)
  response.cookies.set('oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  response.cookies.set('oauth_provider', 'calcom', {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  return response
}
