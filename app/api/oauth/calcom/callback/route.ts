/**
 * Cal.com OAuth callback — exchanges authorization code + PKCE verifier for
 * access + refresh tokens, fetches user info, encrypts and upserts into
 * public.integrations, then redirects back to /integrations with success.
 *
 * Token endpoint: POST https://app.cal.com/oauth/token
 *   grant_type=authorization_code
 *   client_id=...&client_secret=...&code=...&code_verifier=...&redirect_uri=...
 *
 * Userinfo: GET https://api.cal.com/v2/me  Authorization: Bearer <access_token>
 *
 * Token lifetime: access_token ~60min; refresh_token ~1 year. The mcp.cal.com
 * server we delegate to handles its own refresh cycle if we hand it the
 * refresh_token at startup.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '@/lib/encryption'

const CALCOM_TOKEN_URL = 'https://app.cal.com/oauth/token'
const CALCOM_USERINFO_URL = 'https://api.cal.com/v2/me'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const stateFromQuery = url.searchParams.get('state')
  const errorFromProvider = url.searchParams.get('error')

  if (errorFromProvider) {
    return NextResponse.redirect(
      new URL(
        `/integrations?error=${errorFromProvider}&provider=calcom`,
        origin,
      ),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/integrations?error=no_code&provider=calcom', origin),
    )
  }

  // Recover CSRF state + PKCE verifier from cookies.
  const stateFromCookie = req.cookies.get('oauth_state')?.value
  const pkceVerifier = req.cookies.get('oauth_pkce_verifier')?.value
  if (!stateFromCookie || stateFromCookie !== stateFromQuery) {
    return NextResponse.redirect(
      new URL('/integrations?error=state_mismatch&provider=calcom', origin),
    )
  }
  if (!pkceVerifier) {
    return NextResponse.redirect(
      new URL('/integrations?error=missing_pkce&provider=calcom', origin),
    )
  }

  // Verify session.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', origin))

  const clientId = user.app_metadata?.client_id as string | undefined
  if (!clientId) {
    return NextResponse.redirect(new URL('/integrations?error=no_client_id', origin))
  }

  const calcomClientId = process.env.CALCOM_CLIENT_ID
  const calcomClientSecret = process.env.CALCOM_CLIENT_SECRET
  if (!calcomClientId || !calcomClientSecret) {
    return NextResponse.redirect(
      new URL('/integrations?error=not_configured&provider=calcom', origin),
    )
  }

  // Exchange code for tokens.
  const redirectUri = `${origin}/api/oauth/calcom/callback`
  const tokenRes = await fetch(CALCOM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: calcomClientId,
      client_secret: calcomClientSecret,
      code,
      code_verifier: pkceVerifier,
      redirect_uri: redirectUri,
    }),
  }).catch(() => null)

  if (!tokenRes || !tokenRes.ok) {
    const status = tokenRes?.status ?? 'no-response'
    console.error('[calcom-callback] token exchange failed', status)
    return NextResponse.redirect(
      new URL('/integrations?error=token_exchange_failed&provider=calcom', origin),
    )
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  if (!tokens.access_token) {
    return NextResponse.redirect(
      new URL('/integrations?error=no_access_token&provider=calcom', origin),
    )
  }

  // Fetch user profile.
  let calcomUser: { id?: number; username?: string; email?: string; name?: string } = {}
  try {
    const meRes = await fetch(CALCOM_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (meRes.ok) {
      const me = await meRes.json()
      // Cal.com v2 wraps responses: { status: 'success', data: {...} }
      calcomUser = me?.data ?? me ?? {}
    }
  } catch (e) {
    console.error('[calcom-callback] userinfo fetch failed', e)
    // Non-fatal; we have tokens, continue.
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null

  // Upsert.
  const supabaseSvc = svc()
  const { data: row, error } = await supabaseSvc
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'calcom',
        status: 'connected',
        account_email: calcomUser.email ?? null,
        account_name: calcomUser.name ?? calcomUser.username ?? 'Cal.com',
        provider_user_id: calcomUser.id ? String(calcomUser.id) : null,
        access_token_enc: encryptToken(tokens.access_token),
        refresh_token_enc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        token_expires_at: expiresAt,
        scope: tokens.scope ?? null,
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'oauth',
          calcom_username: calcomUser.username ?? null,
          connected_at: new Date().toISOString(),
          connected_by: user?.email ?? null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,provider' },
    )
    .select('id')
    .single()

  if (error) {
    console.error('[calcom-callback] upsert failed', error)
    return NextResponse.redirect(
      new URL('/integrations?error=storage_failed&provider=calcom', origin),
    )
  }

  // Audit + enqueue VPS push.
  try {
    await supabaseSvc.rpc('log_integration_event', {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: 'calcom',
      p_event: 'connected',
      p_payload: {
        username: calcomUser.username,
        scope: tokens.scope,
      },
      p_actor_user_id: user.id,
    })
    await supabaseSvc.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'push_integration_creds',
      triggered_by: 'dashboard:calcom:oauth-callback',
      meta: { provider: 'calcom' },
    })
  } catch (e) {
    console.error('[calcom-callback] post-insert side effects failed', e)
  }

  // Clear OAuth cookies + redirect to success.
  const response = NextResponse.redirect(
    new URL('/integrations?connected=calcom', origin),
  )
  response.cookies.delete('oauth_state')
  response.cookies.delete('oauth_pkce_verifier')
  response.cookies.delete('oauth_provider')
  return response
}
