/**
 * Cal.com OAuth handler — initiates OAuth 2.1 (PKCE) flow against Cal.com.
 *
 * Composio doesn't have a Cal.com toolkit (verified Apr 2026), so we run our
 * own OAuth flow and store the refresh token in integrations.refresh_token_enc.
 * At runtime, the agent talks to Cal.com via the official mcp.cal.com MCP
 * server — we just need a valid OAuth refresh token for that server to use.
 *
 * Cal.com OAuth endpoints (cloud, free + paid):
 *   authorize: https://app.cal.com/oauth/authorize
 *   token:     https://app.cal.com/oauth/token
 *   userinfo:  https://api.cal.com/v2/me   (Bearer access_token)
 *   scopes:    READ_BOOKING WRITE_BOOKING READ_EVENT_TYPE WRITE_EVENT_TYPE
 *              READ_CALENDAR READ_PROFILE
 *
 * Self-host customers get the same OAuth endpoints under their own domain;
 * we use cloud as the default and could add a custom endpoint later if needed.
 *
 * Env required:
 *   CALCOM_CLIENT_ID
 *   CALCOM_CLIENT_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, createHash } from 'crypto'

const CALCOM_AUTH_URL = 'https://app.cal.com/oauth/authorize'
const SCOPES = [
  'READ_BOOKING',
  'WRITE_BOOKING',
  'READ_EVENT_TYPE',
  'WRITE_EVENT_TYPE',
  'READ_CALENDAR',
  'READ_PROFILE',
].join(' ')

// PKCE — Cal.com supports OAuth 2.1 with PKCE. We use S256.
function makePkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function makePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

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

  // CSRF state + PKCE verifier.
  const state = randomBytes(32).toString('hex')
  const codeVerifier = makePkceVerifier()
  const codeChallenge = makePkceChallenge(codeVerifier)
  const redirectUri = `${origin}/api/oauth/calcom/callback`

  const authParams = new URLSearchParams({
    client_id: calcomClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const response = NextResponse.redirect(`${CALCOM_AUTH_URL}?${authParams.toString()}`)
  response.cookies.set('oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  response.cookies.set('oauth_pkce_verifier', codeVerifier, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  response.cookies.set('oauth_provider', 'calcom', {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/',
  })
  return response
}
