/**
 * GET /api/agent/integrations/creds?provider=wordpress
 *
 * VPS-side cred-fetcher. The watcher on each customer VPS calls this to pull
 * decrypted credentials for one of its connected integrations. We authenticate
 * via the existing agent_api_key (oak_...) bearer token, then decrypt the
 * AES-GCM blob server-side and return plaintext over TLS.
 *
 * Why server-side decrypt vs Vault?
 * The existing system already encrypts to integrations.access_token_enc with
 * AES-256-GCM (lib/encryption.ts). The encryption key lives only in Vercel
 * env (ENCRYPTION_KEY); the VPS never holds it. Decryption happens here on
 * the dashboard, plaintext is sent over TLS, then the watcher writes the
 * compound JSON to /opt/clients/{slug}/integrations/{provider}.json (chmod 600).
 *
 * Returned shape varies by auth_mode:
 *   wordpress (compound_pat):
 *     { provider, status, config: { siteUrl, username }, credentials: { appPassword } }
 *   calcom (oauth):
 *     { provider, status, config: { calcom_username }, credentials: { accessToken, refreshToken, expiresAt } }
 *   google_business_profile (oauth):
 *     { provider, status, config: { gbp_account_id }, credentials: { accessToken, refreshToken, expiresAt } }
 *
 * The watcher then writes one JSON file per provider; the custom-mcp-adapter
 * loads them on SIGHUP.
 *
 * Also: every fetch updates `integrations.last_applied_at` to record that
 * the VPS-side has the latest credential. Dashboard uses this to flip the
 * "Applying" pill to "Active".
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'
import { decryptToken } from '@/lib/encryption'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const provider = new URL(req.url).searchParams.get('provider')
  if (!provider) {
    // No provider = list-all mode (used by watcher on startup + reconciliation poll).
    return await listAll(auth.clientId)
  }

  const supabase = svc()
  const { data: row, error } = await supabase
    .from('integrations')
    .select('id, provider, status, access_token_enc, refresh_token_enc, token_expires_at, metadata, blocked_reason, expected_ready_at')
    .eq('client_id', auth.clientId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: `No integration for provider=${provider}` }, { status: 404 })

  // Connectable but creds aren't usable yet (e.g. blocked_external).
  if (row.status === 'blocked_external') {
    return NextResponse.json({
      provider: row.provider,
      status: row.status,
      blocked_reason: row.blocked_reason,
      expected_ready_at: row.expected_ready_at,
      config: row.metadata ?? {},
      credentials: null,
    })
  }

  if (!row.access_token_enc) {
    return NextResponse.json({ error: 'Integration has no credentials yet' }, { status: 409 })
  }

  // Decrypt + shape per auth_mode.
  let result: Record<string, unknown>
  try {
    if (row.metadata?.auth_mode === 'compound_pat') {
      // Compound-PAT shape varies per provider. Each connect route writes a
      // schema-versioned JSON blob into access_token_enc. We decrypt + reshape
      // here so the watcher receives a clean {config, credentials} envelope
      // regardless of provider.
      const decrypted = JSON.parse(decryptToken(row.access_token_enc)) as Record<string, unknown>
      let config: Record<string, unknown>
      let credentials: Record<string, unknown>

      if (row.provider === 'wordpress') {
        const blob = decrypted as { siteUrl: string; username: string; appPassword: string }
        config = { siteUrl: blob.siteUrl, username: blob.username, ...(row.metadata ?? {}) }
        credentials = { appPassword: blob.appPassword }
      } else if (row.provider === 'hostgator_email') {
        const blob = decrypted as {
          emailAddress: string; password: string;
          imapHost: string; imapPort: number;
          smtpHost: string; smtpPort: number; smtpSecure: boolean
        }
        config = {
          emailAddress: blob.emailAddress,
          imapHost: blob.imapHost,
          imapPort: blob.imapPort,
          smtpHost: blob.smtpHost,
          smtpPort: blob.smtpPort,
          smtpSecure: blob.smtpSecure,
          ...(row.metadata ?? {}),
        }
        credentials = { password: blob.password }
      } else if (row.provider === 'salon_booking_system') {
        const blob = decrypted as {
          siteUrl: string
          apiKey: string
          namespace?: string
          authMode?: 'bearer' | 'x_api_key' | 'query'
        }
        config = {
          siteUrl: blob.siteUrl,
          namespace: blob.namespace ?? '/wp-json/salon/api/v1',
          authMode: blob.authMode ?? 'bearer',
          ...(row.metadata ?? {}),
        }
        credentials = { apiKey: blob.apiKey }
      } else {
        return NextResponse.json(
          { error: `compound_pat provider ${row.provider} has no decrypt schema` },
          { status: 500 },
        )
      }

      result = {
        provider: row.provider,
        status: row.status,
        config,
        credentials,
      }
    } else if (row.metadata?.auth_mode === 'oauth') {
      const accessToken = decryptToken(row.access_token_enc)
      const refreshToken = row.refresh_token_enc ? decryptToken(row.refresh_token_enc) : null
      result = {
        provider: row.provider,
        status: row.status,
        config: row.metadata ?? {},
        credentials: {
          accessToken,
          refreshToken,
          expiresAt: row.token_expires_at,
        },
      }
    } else if (row.metadata?.auth_mode === 'pat') {
      // Plain PAT (Fergus). access_token_enc is the bare token.
      result = {
        provider: row.provider,
        status: row.status,
        config: row.metadata ?? {},
        credentials: { token: decryptToken(row.access_token_enc) },
      }
    } else {
      // Composio-managed (Gmail/Calendar/Facebook etc.) — no creds to push;
      // those tools come via composio MCP adapter using its own scoped key.
      return NextResponse.json({
        provider: row.provider,
        status: row.status,
        config: row.metadata ?? {},
        credentials: null,
        note: 'Composio-managed integration — no creds to fetch (provided by composio adapter)',
      })
    }
  } catch (e) {
    console.error(`[creds-api] decrypt failed for ${row.id}`, e)
    return NextResponse.json({ error: 'Decryption failed' }, { status: 500 })
  }

  // No `last_applied_at` ack on the GET path — that field is reserved for
  // confirming the VPS actually wrote the cred to disk, not that it merely
  // fetched. The watcher POSTs to this same endpoint with
  // `X-Watcher-File-Changed: true` ONLY when writeCredFile returns true (real
  // disk change), and that's the path that updates `last_applied_at`. Deep
  // audit H1 (2026-05-01): a stuck-but-still-fetching watcher would otherwise
  // keep the dashboard showing "Active" even if it never wrote a new file.

  return NextResponse.json(result)
}

/**
 * No-provider mode: returns a manifest of all custom-integration providers
 * for this client (status, last_synced_at, expected_ready_at). The watcher
 * uses this on startup + during the reconciliation loop to know which
 * providers it should have local cred files for, and which to garbage-collect.
 */
async function listAll(clientId: string) {
  const supabase = svc()
  const { data, error } = await supabase
    .from('integrations')
    .select('provider, status, metadata, last_applied_at, last_synced_at, expected_ready_at, blocked_reason, updated_at')
    .eq('client_id', clientId)
    .in('provider', ['wordpress', 'hostgator_email', 'google_business_profile', 'salon_booking_system'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    items: (data ?? []).map(row => ({
      provider: row.provider,
      status: row.status,
      auth_mode: row.metadata?.auth_mode ?? 'unknown',
      last_applied_at: row.last_applied_at,
      last_synced_at: row.last_synced_at,
      expected_ready_at: row.expected_ready_at,
      blocked_reason: row.blocked_reason,
      updated_at: row.updated_at,
    })),
  })
}

/**
 * POST /api/agent/integrations/creds — VPS-side ack endpoint.
 *
 * Two distinct ack types, distinguished by the X-Watcher-File-Changed header:
 *
 *   1. File-changed ack (header `X-Watcher-File-Changed: true`).
 *      Called by custom-integrations-watcher.ts ONLY when writeCredFile
 *      actually rewrote a file on disk (real cred change).
 *      Body: { provider, status: 'connected' }.
 *      Side effect: set `last_applied_at = now()` + log `vps_applied` event.
 *      This is the ONLY path that updates last_applied_at — see deep audit H1
 *      (2026-05-01). The cred-fetcher GET intentionally does NOT update it,
 *      so a stuck-but-still-fetching watcher can't keep the dashboard
 *      misleadingly showing "Active".
 *
 *   2. Health-check ack (no header).
 *      Called by custom-mcp-adapter every 5 minutes after pinging providers.
 *      Body: { provider, status: 'ok' | 'fail', error? }.
 *      On 'ok': sets last_health_check_at, resets health_failure_count, flips
 *      degraded → connected.
 *      On 'fail': increments health_failure_count, after 3 consecutive
 *      failures flips connected → degraded (hysteresis to prevent flapping).
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const provider = body.provider as string | undefined
  const status = body.status as 'ok' | 'fail' | 'connected' | undefined
  const errorMsg = body.error as string | undefined
  const fileChanged = req.headers.get('x-watcher-file-changed') === 'true'

  if (!provider || !status) {
    return NextResponse.json({ error: 'provider and status required' }, { status: 400 })
  }
  // Whitelist providers — only the four custom integrations the adapter
  // exposes. Rejecting unknown values stops a compromised oak_ token from
  // triggering side effects on Composio rows or unrelated tables.
  const ALLOWED = new Set(['wordpress', 'hostgator_email', 'google_business_profile', 'salon_booking_system'])
  if (!ALLOWED.has(provider)) {
    return NextResponse.json({ error: `provider must be one of: ${[...ALLOWED].join(', ')}` }, { status: 400 })
  }

  // Branch 1: file-changed ack. Bumps last_applied_at + logs vps_applied.
  // Doesn't touch health-check counters.
  if (fileChanged) {
    if (status !== 'connected') {
      return NextResponse.json({ error: 'X-Watcher-File-Changed requires status="connected"' }, { status: 400 })
    }
    const supabase = svc()
    const { data: row } = await supabase
      .from('integrations')
      .select('id, token_expires_at')
      .eq('client_id', auth.clientId)
      .eq('provider', provider)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'No such integration' }, { status: 404 })
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('integrations')
      .update({ last_applied_at: now })
      .eq('id', row.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    after(async () => {
      try {
        await supabase.rpc('log_integration_event', {
          p_integration_id: row.id,
          p_client_id: auth.clientId,
          p_provider: provider,
          p_event: 'vps_applied',
          p_payload: { token_expires_at: row.token_expires_at },
          p_actor_user_id: null,
        })
      } catch (e) {
        console.error('[creds-api] vps_applied audit failed:', e)
      }
    })
    return NextResponse.json({ ok: true })
  }

  if (status !== 'ok' && status !== 'fail') {
    return NextResponse.json({ error: 'status must be "ok" or "fail"' }, { status: 400 })
  }

  const supabase = svc()
  const { data: row } = await supabase
    .from('integrations')
    .select('id, status, health_failure_count')
    .eq('client_id', auth.clientId)
    .eq('provider', provider)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'No such integration' }, { status: 404 })

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }
  let event: 'health_check_passed' | 'health_check_failed'

  if (status === 'ok') {
    update.last_health_check_at = now
    update.health_failure_count = 0
    update.error_message = null
    // Hysteresis: only un-degrade after a successful check.
    if (row.status === 'degraded') update.status = 'connected'
    event = 'health_check_passed'
  } else {
    const newCount = (row.health_failure_count ?? 0) + 1
    update.health_failure_count = newCount
    update.error_message = errorMsg ?? 'Health check failed'
    // After 3 consecutive failures, flip to degraded. Don't ever flip
    // healthy connections from `connected` to `error` here — that's
    // reserved for hard auth failures (401/403). Transient API errors
    // are visibility-only.
    if (newCount >= 3 && row.status === 'connected') {
      update.status = 'degraded'
    }
    event = 'health_check_failed'
  }

  const { error } = await supabase.from('integrations').update(update).eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // `after()` runs post-response in the same lambda — replaces the
  // void+then(noop) pattern that doesn't survive serverless freeze.
  after(async () => {
    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: auth.clientId,
        p_provider: provider,
        p_event: event,
        p_payload: { error: errorMsg ?? null, failure_count: update.health_failure_count },
        p_actor_user_id: null,
      })
    } catch (e) {
      console.error('[creds-api] health-check audit failed:', e)
    }
  })

  return NextResponse.json({ ok: true, status: update.status ?? row.status })
}
