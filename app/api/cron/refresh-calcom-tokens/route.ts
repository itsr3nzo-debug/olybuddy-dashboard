/**
 * GET /api/cron/refresh-calcom-tokens
 *
 * Vercel cron — every 50 minutes. Cal.com access tokens last ~60 minutes;
 * refresh tokens last ~1 year. We proactively refresh ~10 min before expiry.
 *
 * Cal.com token refresh: POST https://app.cal.com/oauth/token
 *   grant_type=refresh_token&client_id=...&client_secret=...&refresh_token=...
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { encryptToken, decryptToken } from '@/lib/encryption'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
// Verified against cal.com/docs/api-reference/v2/oauth (May 2026):
// token URL is on api.cal.com/v2 not app.cal.com.
const TOKEN_URL = 'https://api.cal.com/v2/auth/oauth2/token'

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const calcomClientId = process.env.CALCOM_CLIENT_ID
  const calcomClientSecret = process.env.CALCOM_CLIENT_SECRET
  if (!calcomClientId || !calcomClientSecret) {
    return NextResponse.json({ error: 'Cal.com OAuth not configured' }, { status: 500 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data: rows, error: queryErr } = await supabase
    .from('integrations')
    .select('id, client_id, refresh_token_enc, token_expires_at')
    .eq('provider', 'calcom')
    .in('status', ['connected', 'degraded', 'refreshing'])
    .not('refresh_token_enc', 'is', null)

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 })
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, refreshed: 0, skipped: 0, failed: 0 })
  }

  let refreshed = 0, skipped = 0, failed = 0
  const now = Date.now()
  const REFRESH_WINDOW_MS = 10 * 60 * 1000

  for (const row of rows) {
    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0
    if (expiresAt && expiresAt - now > REFRESH_WINDOW_MS) { skipped++; continue }

    let refreshToken: string
    try { refreshToken = decryptToken(row.refresh_token_enc!) }
    catch (e) { console.error(`[refresh-calcom] decrypt failed for ${row.id}`, e); failed++; continue }

    await supabase.from('integrations').update({
      status: 'refreshing', updated_at: new Date().toISOString(),
    }).eq('id', row.id)

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: calcomClientId,
        client_secret: calcomClientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)

    if (!tokenRes) {
      // Network error — restore status so dashboard doesn't stick on 'refreshing'.
      await supabase.from('integrations').update({
        status: 'connected',
        error_message: 'Network error during token refresh; will retry',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      failed++; continue
    }
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => '')
      await supabase.from('integrations').update({
        status: 'expired',
        error_message: `Cal.com refresh failed: ${tokenRes.status}`,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      try {
        await supabase.rpc('log_integration_event', {
          p_integration_id: row.id, p_client_id: row.client_id,
          p_provider: 'calcom', p_event: 'token_refresh_failed',
          p_payload: { http_status: tokenRes.status, body: body.slice(0, 200) },
          p_actor_user_id: null,
        })
      } catch {}
      failed++; continue
    }

    const tokens = await tokenRes.json() as { access_token: string, refresh_token?: string, expires_in?: number }
    const newExpiresAt = tokens.expires_in
      ? new Date(now + tokens.expires_in * 1000).toISOString()
      : null

    await supabase.from('integrations').update({
      access_token_enc: encryptToken(tokens.access_token),
      // Cal.com may issue a new refresh_token on each refresh (rotation) — store it if so.
      refresh_token_enc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : row.refresh_token_enc,
      token_expires_at: newExpiresAt,
      status: 'connected',
      error_message: null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)

    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id, p_client_id: row.client_id,
        p_provider: 'calcom', p_event: 'token_refreshed',
        p_payload: { expires_at: newExpiresAt }, p_actor_user_id: null,
      })
      await supabase.from('provisioning_queue').insert({
        client_id: row.client_id,
        action: 'push_integration_creds',
        triggered_by: 'cron:refresh-calcom-tokens',
        meta: { provider: 'calcom' },
      })
    } catch {}
    refreshed++
  }

  return NextResponse.json({ ok: true, refreshed, skipped, failed, total: rows.length })
}
