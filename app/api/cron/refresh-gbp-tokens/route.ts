/**
 * GET /api/cron/refresh-gbp-tokens
 *
 * Vercel cron — every 50 minutes. Google Business Profile access tokens
 * expire after 60 minutes; we proactively refresh ~10 min before expiry
 * to avoid in-flight failures.
 *
 * Behaviour:
 *  - For each integration with provider='google_business_profile',
 *    status IN ('connected','degraded','refreshing'), and refresh_token_enc
 *    set: exchange refresh → new access token, encrypt + write back.
 *  - On success: status=connected, last_synced_at=now, audit token_refreshed.
 *  - On failure (4xx): status=expired, audit token_refresh_failed.
 *  - Network errors don't flip state — let next tick retry.
 *  - Enqueue push_integration_creds for any successful refresh so the VPS
 *    picks up the new access token immediately.
 *
 * In Test Mode (sensitive scope unverified), Google revokes refresh tokens
 * after 7 days, so refresh failures with `invalid_grant` are expected weekly
 * until production verification clears. We surface that as `expired` to
 * trigger the dashboard "Reconnect" UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encryptToken, decryptToken } from '@/lib/encryption'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const gbpClientId = process.env.GOOGLE_GBP_CLIENT_ID
  const gbpClientSecret = process.env.GOOGLE_GBP_CLIENT_SECRET
  if (!gbpClientId || !gbpClientSecret) {
    return NextResponse.json({ error: 'GBP OAuth not configured' }, { status: 500 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Find rows that need refreshing.
  const { data: rows, error: queryErr } = await supabase
    .from('integrations')
    .select('id, client_id, refresh_token_enc, token_expires_at')
    .eq('provider', 'google_business_profile')
    .in('status', ['connected', 'degraded', 'refreshing'])
    .not('refresh_token_enc', 'is', null)

  if (queryErr) {
    console.error('[refresh-gbp-tokens] query failed', queryErr)
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, refreshed: 0, skipped: 0, failed: 0 })
  }

  let refreshed = 0
  let skipped = 0
  let failed = 0
  const now = Date.now()
  const REFRESH_WINDOW_MS = 10 * 60 * 1000   // refresh if expires within 10 min

  for (const row of rows) {
    // Skip if token isn't due for refresh yet.
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0
    if (expiresAt && expiresAt - now > REFRESH_WINDOW_MS) {
      skipped++
      continue
    }

    let refreshToken: string
    try {
      refreshToken = decryptToken(row.refresh_token_enc!)
    } catch (e) {
      console.error(`[refresh-gbp-tokens] decrypt failed for ${row.id}`, e)
      failed++
      continue
    }

    // Mark as refreshing so dashboard shows correct state.
    await supabase
      .from('integrations')
      .update({ status: 'refreshing', updated_at: new Date().toISOString() })
      .eq('id', row.id)

    // Exchange refresh token for new access token.
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: gbpClientId,
        client_secret: gbpClientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)

    if (!tokenRes) {
      // Network error — leave row as 'refreshing' for next tick.
      console.error(`[refresh-gbp-tokens] network error for ${row.id}`)
      failed++
      continue
    }

    if (!tokenRes.ok) {
      // 4xx error — flip to expired so user can reconnect.
      const body = await tokenRes.text().catch(() => '')
      console.error(`[refresh-gbp-tokens] HTTP ${tokenRes.status} for ${row.id}: ${body.slice(0, 200)}`)

      await supabase
        .from('integrations')
        .update({
          status: 'expired',
          error_message: `Refresh failed: ${tokenRes.status}. Common cause: GBP OAuth in test mode (refresh tokens expire weekly until verification clears).`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      try {
        await supabase.rpc('log_integration_event', {
          p_integration_id: row.id,
          p_client_id: row.client_id,
          p_provider: 'google_business_profile',
          p_event: 'token_refresh_failed',
          p_payload: { http_status: tokenRes.status, body: body.slice(0, 200) },
          p_actor_user_id: null,
        })
      } catch (e) { console.error('[refresh-gbp-tokens] audit failed', e) }

      failed++
      continue
    }

    const tokens = await tokenRes.json() as {
      access_token: string
      expires_in?: number
      scope?: string
    }

    const newExpiresAt = tokens.expires_in
      ? new Date(now + tokens.expires_in * 1000).toISOString()
      : null

    const { error: updateErr } = await supabase
      .from('integrations')
      .update({
        access_token_enc: encryptToken(tokens.access_token),
        token_expires_at: newExpiresAt,
        status: 'connected',
        error_message: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)

    if (updateErr) {
      console.error(`[refresh-gbp-tokens] update failed for ${row.id}`, updateErr)
      failed++
      continue
    }

    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: row.client_id,
        p_provider: 'google_business_profile',
        p_event: 'token_refreshed',
        p_payload: { expires_at: newExpiresAt },
        p_actor_user_id: null,
      })
      // Push the new creds to VPS so the in-memory adapter has them.
      await supabase.from('provisioning_queue').insert({
        client_id: row.client_id,
        action: 'push_integration_creds',
        triggered_by: 'cron:refresh-gbp-tokens',
        meta: { provider: 'google_business_profile' },
      })
    } catch (e) { console.error('[refresh-gbp-tokens] post-update failed', e) }

    refreshed++
  }

  return NextResponse.json({ ok: true, refreshed, skipped, failed, total: rows.length })
}
