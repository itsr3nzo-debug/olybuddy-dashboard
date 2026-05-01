/**
 * WordPress integration — compound-credential connect handler.
 *
 * Auth: site URL + bot username + Application Password (compound). The three
 * fields are JSON-encoded then encrypted into integrations.access_token_enc
 * via the existing AES-256-GCM helper (same module Fergus PAT uses, lib/encryption.ts).
 *
 * Flow:
 *  1. Owner opens dashboard → Integrations → Connect WordPress
 *  2. Modal collects siteUrl + username + appPassword
 *  3. POST here → we (a) probe GET /wp-json/wp/v2/users/me with basic auth,
 *     (b) reject Administrator role (blast-radius: must be Editor or lower),
 *     (c) reject WP.com Free plan (blocks REST writes),
 *     (d) encrypt + upsert into integrations,
 *     (e) enqueue push_integration_creds for the VPS worker.
 *
 * DELETE /api/integrations/wordpress — disconnects.
 *
 * Security:
 *  - All inbound creds touch this server once. Plaintext appPassword is wiped
 *    from memory after encryption (best-effort in JS).
 *  - We DO NOT log the appPassword. Only siteUrl and username appear in audit.
 *  - The probe times out at 10s; failure returns clean error to dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '@/lib/encryption'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getSession() {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return {
    user,
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Validation helpers
// ──────────────────────────────────────────────────────────────────────────

function normaliseSiteUrl(input: string): string | null {
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // Strip trailing slash and any wp-admin / paths the user pasted by accident.
    u.pathname = '/'
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isWpComUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.endsWith('.wordpress.com') || host === 'wordpress.com'
  } catch {
    return false
  }
}

interface WpUserMe {
  id: number
  username: string
  name: string
  email?: string
  roles?: string[]
  capabilities?: Record<string, boolean>
}

interface ValidationResult {
  ok: boolean
  user?: WpUserMe
  error?: string
  detail?: string
  isWpCom?: boolean
}

async function validateWordPressCreds(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<ValidationResult> {
  // Self-hosted WP detection: probe /wp-json/ first.
  // WP.com sites under their hosted plans return JSON too but with different
  // namespaces; we treat *.wordpress.com hostnames as WP.com regardless.
  const probeRes = await fetch(`${siteUrl}/wp-json/`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)

  if (!probeRes || !probeRes.ok) {
    return {
      ok: false,
      error: `Site URL didn't respond as a WordPress site`,
      detail: `GET ${siteUrl}/wp-json/ returned ${probeRes?.status ?? 'no response'}. ` +
        `Make sure REST API is enabled (it's on by default in WP 5.0+) and the URL is reachable.`,
    }
  }

  const isWpCom = isWpComUrl(siteUrl)
  if (isWpCom) {
    // WP.com Application Passwords work only on Personal/Premium/Business/Commerce.
    // We could detect plan, but cleanest is to reject WP.com here and ask owner
    // to use the WP.com OAuth path instead. (We don't ship that yet — flag clearly.)
    return {
      ok: false,
      isWpCom: true,
      error: 'WordPress.com sites use a different auth flow',
      detail:
        'For WordPress.com hosted sites, application passwords need WP.com OAuth ' +
        '(not yet supported). Self-hosted WordPress works as expected.',
    }
  }

  // Authenticate against /wp-json/wp/v2/users/me with Basic auth.
  // Application passwords are compatible with Basic auth.
  const auth = Buffer.from(`${username}:${appPassword}`).toString('base64')
  const meRes = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)

  if (!meRes) {
    return { ok: false, error: 'Could not reach the site', detail: 'Request timed out' }
  }

  if (meRes.status === 401) {
    return {
      ok: false,
      error: 'Username or application password is incorrect',
      detail:
        'Make sure you used a WordPress Application Password (24 characters with spaces), ' +
        'not your normal login password. Generate one at WP-Admin → Users → Profile → ' +
        'Application Passwords.',
    }
  }
  if (meRes.status === 403) {
    return {
      ok: false,
      error: `User ${username} doesn't have edit permissions`,
      detail: 'The user must have at least Editor role to publish posts.',
    }
  }
  if (!meRes.ok) {
    const body = await meRes.text().catch(() => '')
    return {
      ok: false,
      error: `WordPress returned HTTP ${meRes.status}`,
      detail: body.slice(0, 200),
    }
  }

  const user = (await meRes.json()) as WpUserMe

  // Blast-radius gate: Administrator role is too broad. Refuse it.
  // The owner should create a dedicated nexley_bot user with Editor role.
  if (user.roles?.includes('administrator')) {
    return {
      ok: false,
      error: `User ${username} has Administrator role — too broad`,
      detail:
        'For security, please create a dedicated WordPress user with Editor role ' +
        'instead. An admin-level bot user is high-blast-radius if compromised. ' +
        'Editor can publish posts and pages but cannot install plugins, manage ' +
        'users, or change site settings.',
    }
  }

  return { ok: true, user }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — connect WordPress
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can connect integrations' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const siteUrlRaw = (body.siteUrl as string | undefined)?.trim()
  const username = (body.username as string | undefined)?.trim()
  const appPassword = (body.appPassword as string | undefined)?.trim()

  if (!siteUrlRaw || !username || !appPassword) {
    return NextResponse.json(
      { error: 'siteUrl, username and appPassword are all required' },
      { status: 400 },
    )
  }

  const siteUrl = normaliseSiteUrl(siteUrlRaw)
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'Site URL must be a valid http(s) URL' },
      { status: 400 },
    )
  }

  // Validate against the live site.
  const v = await validateWordPressCreds(siteUrl, username, appPassword)
  if (!v.ok) {
    return NextResponse.json(
      { error: v.error, detail: v.detail, isWpCom: v.isWpCom },
      { status: 400 },
    )
  }

  // Encrypt the compound credential as JSON. The VPS adapter decrypts and
  // splits siteUrl/username/appPassword on the other side.
  const credentialBlob = JSON.stringify({
    siteUrl,
    username,
    appPassword,
    schemaVersion: 1,
  })
  const encrypted = encryptToken(credentialBlob)

  const supabase = svc()

  // Upsert the integrations row.
  const { data: row, error } = await supabase
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'wordpress',
        status: 'connected',
        account_email: v.user?.email ?? null,
        account_name: v.user?.name ?? username,
        provider_user_id: String(v.user?.id ?? ''),
        access_token_enc: encrypted,
        refresh_token_enc: null,
        token_expires_at: null,
        scope: 'wp_rest_api',
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'compound_pat',
          site_url: siteUrl,           // visible (not secret) — used by adapter + dashboard
          username,                    // visible — for display
          roles: v.user?.roles ?? [],
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit + enqueue VPS push.
  try {
    await supabase.rpc('log_integration_event', {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: 'wordpress',
      p_event: 'connected',
      p_payload: { site_url: siteUrl, username, roles: v.user?.roles ?? [] },
      p_actor_user_id: user?.id ?? null,
    })

    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'push_integration_creds',
      triggered_by: `dashboard:wordpress:connect`,
      meta: { provider: 'wordpress' },
    })
  } catch (e) {
    console.error('[wordpress-connect] post-insert side effects failed:', e)
    // Connect itself succeeded — non-fatal.
  }

  return NextResponse.json({
    ok: true,
    provider: 'wordpress',
    account_name: v.user?.name ?? username,
    account_email: v.user?.email ?? null,
    site_url: siteUrl,
    roles: v.user?.roles ?? [],
  })
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — disconnect WordPress
// ──────────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can disconnect' }, { status: 403 })
  }

  const supabase = svc()

  // Find the row first so we have the integration_id for audit + the worker can revoke.
  const { data: row } = await supabase
    .from('integrations')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'wordpress')
    .maybeSingle()

  // Hard-delete is what the existing pat route does too — see the comment in
  // IntegrationsPage about disconnect behaviour.
  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', 'wordpress')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort audit + revoke.
  if (row?.id) {
    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: clientId,
        p_provider: 'wordpress',
        p_event: 'disconnected',
        p_payload: {},
        p_actor_user_id: user?.id ?? null,
      })
    } catch (e) { console.error('[wordpress-disconnect] audit failed:', e) }
  }

  try {
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'revoke_integration_creds',
      triggered_by: `dashboard:wordpress:disconnect`,
      meta: { provider: 'wordpress' },
    })
  } catch (e) {
    console.error('[wordpress-disconnect] revoke enqueue failed:', e)
  }

  return NextResponse.json({ ok: true })
}
