/**
 * Google Business Profile OAuth callback.
 *
 * Token endpoint: POST https://oauth2.googleapis.com/token
 * After exchange:
 *  1. Probe https://mybusinessaccountmanagement.googleapis.com/v1/accounts to
 *     find which account/locations the user manages.
 *  2. If the API rejects with 403/PERMISSION_DENIED, status = 'blocked_external'
 *     with blocked_reason = 'gbp_60day_gate' OR 'gbp_oauth_unverified' depending
 *     on how Google framed the rejection.
 *  3. Otherwise status = 'connected', metadata.gbp_account_id captured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '@/lib/encryption'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GBP_ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

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
      new URL(`/integrations?error=${errorFromProvider}&provider=google_business_profile`, origin),
    )
  }
  if (!code) {
    return NextResponse.redirect(
      new URL('/integrations?error=no_code&provider=google_business_profile', origin),
    )
  }

  const stateFromCookie = req.cookies.get('oauth_state')?.value
  if (!stateFromCookie || stateFromCookie !== stateFromQuery) {
    return NextResponse.redirect(
      new URL('/integrations?error=state_mismatch&provider=google_business_profile', origin),
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

  const gbpClientId = process.env.GOOGLE_GBP_CLIENT_ID
  const gbpClientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET
  if (!gbpClientId || !gbpClientSecret) {
    return NextResponse.redirect(
      new URL('/integrations?error=not_configured&provider=google_business_profile', origin),
    )
  }

  const redirectUri = `${origin}/api/oauth/google_business_profile/callback`
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: gbpClientId,
      client_secret: gbpClientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  }).catch(() => null)

  if (!tokenRes || !tokenRes.ok) {
    console.error('[gbp-callback] token exchange failed', tokenRes?.status)
    return NextResponse.redirect(
      new URL('/integrations?error=token_exchange_failed&provider=google_business_profile', origin),
    )
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(
      new URL('/integrations?error=no_refresh_token&provider=google_business_profile', origin),
    )
  }

  // Pull userinfo (always works — same as Gmail OAuth).
  let email: string | undefined, name: string | undefined
  try {
    const u = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (u.ok) {
      const data = await u.json()
      email = data.email; name = data.name
    }
  } catch (e) { console.error('[gbp-callback] userinfo failed', e) }

  // Probe GBP API. If listing isn't 60-day-verified, this returns 403 with
  // a specific PERMISSION_DENIED reason. We capture the rejection and store
  // status='blocked_external' so the dashboard can show "Verifying with Google".
  let gbpAccountId: string | undefined
  let gbpAccountName: string | undefined
  let blocked = false
  let blockedReason: string | undefined
  let expectedReadyAt: string | undefined

  try {
    const accountsRes = await fetch(GBP_ACCOUNTS_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (accountsRes.ok) {
      const data = await accountsRes.json()
      const acct = data?.accounts?.[0]
      if (acct) {
        gbpAccountId = acct.name        // e.g. "accounts/12345"
        gbpAccountName = acct.accountName ?? acct.name
      }
      if (!acct) {
        // No account associated yet. Owner must accept the manager invite
        // OR verify their listing first.
        blocked = true
        blockedReason = 'gbp_no_accounts_yet'
      }
    } else if (accountsRes.status === 403) {
      blocked = true
      const body = await accountsRes.text().catch(() => '')
      // Two main reasons we'd see this:
      //   (a) sensitive scope not yet verified (test mode + non-allowlisted user)
      //   (b) 60-day listing-age gate
      // We can't always distinguish, so set a generic reason and let the
      // backoffice resolve manually.
      blockedReason = body.toLowerCase().includes('not allowed')
        ? 'gbp_oauth_unverified'
        : 'gbp_60day_gate'
      // Optimistic ETA: 60 days from now if it's the gate; ~14 days if it's OAuth review.
      const etaDays = blockedReason === 'gbp_60day_gate' ? 60 : 14
      expectedReadyAt = new Date(Date.now() + etaDays * 24 * 3600 * 1000).toISOString()
    } else {
      console.error('[gbp-callback] unexpected accounts response', accountsRes.status)
    }
  } catch (e) {
    console.error('[gbp-callback] accounts probe failed', e)
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null

  const supabaseSvc = svc()
  const { data: row, error } = await supabaseSvc
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'google_business_profile',
        status: blocked ? 'blocked_external' : 'connected',
        blocked_reason: blocked ? blockedReason : null,
        expected_ready_at: blocked ? expectedReadyAt : null,
        account_email: email ?? null,
        account_name: gbpAccountName ?? name ?? 'Google Business Profile',
        provider_user_id: gbpAccountId ?? null,
        access_token_enc: encryptToken(tokens.access_token),
        refresh_token_enc: encryptToken(tokens.refresh_token),
        token_expires_at: expiresAt,
        scope: tokens.scope ?? null,
        last_synced_at: new Date().toISOString(),
        last_health_check_at: blocked ? null : new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'oauth',
          gbp_account_id: gbpAccountId ?? null,
          gbp_account_name: gbpAccountName ?? null,
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
    console.error('[gbp-callback] upsert failed', error)
    return NextResponse.redirect(
      new URL('/integrations?error=storage_failed&provider=google_business_profile', origin),
    )
  }

  // Audit.
  try {
    await supabaseSvc.rpc('log_integration_event', {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: 'google_business_profile',
      p_event: blocked ? 'blocked_external' : 'connected',
      p_payload: {
        gbp_account_id: gbpAccountId,
        blocked_reason: blockedReason,
        expected_ready_at: expectedReadyAt,
      },
      p_actor_user_id: user.id,
    })
    if (!blocked) {
      await supabaseSvc.from('provisioning_queue').insert({
        client_id: clientId,
        action: 'push_integration_creds',
        triggered_by: 'dashboard:gbp:oauth-callback',
        meta: { provider: 'google_business_profile' },
      })
    }
  } catch (e) { console.error('[gbp-callback] post-insert side effects failed', e) }

  const successQs = blocked
    ? `?error=blocked_external&provider=google_business_profile&reason=${blockedReason}`
    : '?connected=google_business_profile'

  const response = NextResponse.redirect(new URL(`/integrations${successQs}`, origin))
  response.cookies.delete('oauth_state')
  response.cookies.delete('oauth_provider')
  return response
}
