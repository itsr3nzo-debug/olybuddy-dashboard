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
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

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
    // Reject non-standard ports — WP self-hosted is always on :80 or :443.
    // This blocks pivots to internal services (Postgres :5432, Redis :6379,
    // Supabase :54321, ES :9200, etc.) that happen to share hostname with a
    // WP install.
    if (u.port && u.port !== '80' && u.port !== '443') return null
    // Preserve subdirectory paths (e.g. example.com/blog/) — common for
    // WP-in-subdirectory installs. Strip ONLY trailing wp-admin/wp-login the
    // user pasted by accident. Devil's-advocate #17 (2026-05-01).
    u.pathname = u.pathname.replace(/\/(wp-admin|wp-login\.php).*$/, '/')
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

// SSRF guard. Returns null when the host is safe to fetch from a Vercel egress
// IP, or a string error reason otherwise. Caller must call this BEFORE any
// fetch() against a user-supplied URL — and pass `redirect: 'manual'` to fetch
// so a public host returning a 302 to a private host can't bypass the check.
//
// 2026-05-01 deep audit C1: prior code did `fetch(siteUrl)` with no allowlist,
// no DNS resolution, default redirect-following, and reflected up to 200 bytes
// of response body back to the client — a textbook reflected SSRF that exposes
// every HTTP service reachable from Vercel's egress (Supabase internal,
// metadata services, internal company VPN, etc.).
async function assertSafeUrl(rawUrl: string): Promise<string | null> {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return 'invalid URL'
  }

  // Block obvious aliases for self / link-local before DNS.
  const hostLower = u.hostname.toLowerCase()
  const blockedHosts = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata',
    'instance-data',
    'instance-data.ec2.internal',
  ])
  if (blockedHosts.has(hostLower)) return 'host is reserved/internal'
  if (hostLower.endsWith('.internal')) return 'host is reserved/internal'
  if (hostLower.endsWith('.local')) return 'host is reserved/internal'
  if (hostLower.endsWith('.localhost')) return 'host is reserved/internal'
  if (hostLower.endsWith('.svc') || hostLower.endsWith('.svc.cluster.local')) return 'host is reserved/internal'

  // Resolve hostname → IP. Reject if it's in any private/link-local/loopback
  // range. We resolve here ourselves (not via fetch) so we can block before
  // the request hits the wire. Note: a public hostname resolving to a private
  // IP (DNS rebinding) is still possible mid-request, but `fetch` opens a
  // single connection and our redirect:'manual' below blocks the second hop.
  let resolved: { address: string; family: number }
  try {
    resolved = await dnsLookup(u.hostname)
  } catch {
    return 'DNS resolution failed'
  }
  const reason = isPrivateIp(resolved.address, resolved.family)
  if (reason) return reason

  return null
}

function isPrivateIp(addr: string, family: number): string | null {
  // If addr came back as a literal IP (rare, but happens for IPv4-mapped IPv6
  // and for hostnames that ARE IPs), validate as IP.
  if (family === 4 || isIP(addr) === 4) {
    const parts = addr.split('.').map((n) => parseInt(n, 10))
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return 'invalid IPv4'
    }
    const [a, b] = parts
    if (a === 10) return 'private IPv4 (10.0.0.0/8)'
    if (a === 127) return 'loopback IPv4 (127.0.0.0/8)'
    if (a === 169 && b === 254) return 'link-local IPv4 (169.254.0.0/16)' // includes AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return 'private IPv4 (172.16.0.0/12)'
    if (a === 192 && b === 168) return 'private IPv4 (192.168.0.0/16)'
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT IPv4 (100.64.0.0/10)'
    if (a === 0) return 'reserved IPv4 (0.0.0.0/8)'
    if (a >= 224) return 'multicast/reserved IPv4'
    return null
  }
  if (family === 6 || isIP(addr) === 6) {
    const lc = addr.toLowerCase()
    if (lc === '::1' || lc === '0:0:0:0:0:0:0:1') return 'loopback IPv6 (::1)'
    if (lc.startsWith('fe80:') || lc.startsWith('fe9') || lc.startsWith('fea') || lc.startsWith('feb'))
      return 'link-local IPv6 (fe80::/10)'
    if (lc.startsWith('fc') || lc.startsWith('fd')) return 'unique-local IPv6 (fc00::/7)'
    if (lc.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — recurse on the v4 portion.
      const v4 = lc.slice('::ffff:'.length)
      return isPrivateIp(v4, 4)
    }
    if (lc.startsWith('ff')) return 'multicast IPv6 (ff00::/8)'
    return null
  }
  return 'unknown address family'
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
  // SSRF guard — runs BEFORE any fetch. Resolves DNS and rejects private IPs
  // (loopback, RFC1918, link-local incl. AWS metadata, CGNAT, multicast).
  const blockReason = await assertSafeUrl(`${siteUrl}/wp-json/`)
  if (blockReason) {
    return {
      ok: false,
      error: 'Site URL is not reachable from a public network',
      detail: `Refusing to probe ${siteUrl} — ${blockReason}.`,
    }
  }

  // Self-hosted WP detection: probe /wp-json/ first.
  // WP.com sites under their hosted plans return JSON too but with different
  // namespaces; we treat *.wordpress.com hostnames as WP.com regardless.
  // redirect:'manual' so a public WP site returning a 302 to a private host
  // can't pivot us into an internal service (DNS-rebinding-style attack).
  const probeRes = await fetch(`${siteUrl}/wp-json/`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
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
    redirect: 'manual',
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
    // Don't leak response body — it could be from any reachable endpoint
    // (the SSRF guard prevents private IPs but a hijacked public DNS could
    // still serve crafted JSON). Generic message only.
    return {
      ok: false,
      error: `WordPress returned HTTP ${meRes.status}`,
      detail: 'The server reached your site but it didn\'t accept the credentials. ' +
        'Double-check the username and Application Password.',
    }
  }

  const user = (await meRes.json()) as WpUserMe

  // Blast-radius gate: deny any user with admin-equivalent capabilities.
  // Capability-based check is robust against custom-role naming (e.g. "super_admin",
  // "shop_manager_pro" with manage_options) — slug match alone (just rejecting
  // 'administrator') misses these. Deep audit H5 (2026-05-01).
  const adminCaps = [
    'manage_options',     // change site settings
    'install_plugins',    // RCE vector
    'install_themes',
    'edit_users',         // user enumeration / privilege escalation
    'create_users',
    'delete_users',
    'promote_users',
    'manage_network',     // multisite admin
    'edit_dashboard',     // backend control
    'switch_themes',
  ]
  const userCaps = user.capabilities ?? {}
  const dangerousCap = adminCaps.find((c) => userCaps[c] === true)
  if (dangerousCap || user.roles?.includes('administrator') || user.roles?.includes('super_admin')) {
    return {
      ok: false,
      error: `User ${username} has admin-level permissions (${dangerousCap || 'role'}) — too broad`,
      detail:
        'For security, please create a dedicated WordPress user with Editor role ' +
        'instead. An admin-level bot user is high-blast-radius if compromised. ' +
        'Editor can publish posts and pages but cannot install plugins, manage ' +
        'users, or change site settings.',
    }
  }

  // Fail-closed: require POSITIVE proof of an Editor-or-below role + a
  // capability matching publish_posts. Audit round 3 finding H3 — previous
  // version accepted users where roles=[] AND capabilities={} (e.g. a custom
  // REST endpoint that strips both fields), since neither admin trip-wire
  // fired. Now: must have at least one recognised role with positive
  // edit/publish capability.
  const allowedRoles = ['editor', 'author', 'contributor', 'shop_manager']
  const hasAllowedRole = (user.roles ?? []).some((r) => allowedRoles.includes(r))
  const requiredCap = userCaps.publish_posts === true || userCaps.edit_posts === true
  if (!hasAllowedRole && !requiredCap) {
    return {
      ok: false,
      error: `User ${username} has no recognised editor/author role and no publish/edit capability`,
      detail:
        'The bot user must have at least the WordPress Editor role (or Author / Contributor / Shop Manager) ' +
        'with publish_posts or edit_posts capability. We could not detect either — likely the user has only ' +
        'a custom role that strips standard capabilities, or the WP REST API on this site is filtering ' +
        'these fields. Try creating a fresh user with the standard "Editor" role.',
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
