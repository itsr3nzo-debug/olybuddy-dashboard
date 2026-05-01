/**
 * Salon Booking System (WordPress plugin) — connect handler.
 *
 * Auth: site URL + plugin API key (issued in WP-Admin → Salon → Settings → API).
 *
 * Validation flow:
 *  1. Normalise siteUrl, refuse private/loopback after DNS lookup
 *  2. Probe the plugin's REST namespace at /wp-json/salon/api/v1/services
 *     with the API key as a Bearer token. If 200 — auth works. 401 — bad key.
 *     404 — plugin not installed / not Pro version (free version has no API).
 *  3. Encrypt the compound credential, upsert, enqueue VPS push
 *
 * Known caveat: the SBS Pro plugin's REST documentation is partially gated
 * behind a SwaggerHub login. We're targeting the documented namespace
 * /wp-json/salon/api/v1 and the documented bearer-style auth. If a customer
 * has a non-standard build (custom auth filter, different prefix), they'll
 * surface a 401/404 with our friendly error and we'll iterate.
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

function normaliseSiteUrl(input: string): string | null {
  // Preserve subdirectory pathname (e.g. https://example.com/blog/) — common for
  // WP-in-subdirectory installs where the REST API is at /blog/wp-json/...
  // Devil's-advocate finding #17 (2026-05-01): prior version stripped paths
  // entirely, breaking every subdirectory install.
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // Strip ONLY trailing /wp-admin or /wp-login.php that the user pasted by
    // accident. Keep any other pathname.
    u.pathname = u.pathname.replace(/\/(wp-admin|wp-login\.php).*$/, '/')
    u.search = ''
    u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isPrivateIp(ip: string): boolean {
  if (!isIP(ip)) return false
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true
  const parts = ip.split('.').map(Number)
  if (parts[0] === 127) return true
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  if (parts[0] === 0) return true
  return false
}

interface SbsValidation {
  ok: boolean
  error?: string
  detail?: string
  servicesFound?: number
}

// SBS plugin REST documentation is partially gated behind a SwaggerHub login
// so we don't have one canonical (namespace, auth) combo. This validator
// probes a small matrix of plausible combos and reports which one worked.
// Once we have a confirmed live install, narrow this down.
const SBS_NAMESPACES = [
  '/wp-json/salon/api/v1',
  '/wp-json/salon-booking-system/v1',
  '/wp-json/sb/v1',
] as const

type AuthMode = 'bearer' | 'x_api_key' | 'query'
const SBS_AUTH_MODES: AuthMode[] = ['bearer', 'x_api_key', 'query']

interface SbsProbeHit {
  namespace: string
  authMode: AuthMode
  servicesCount: number
}

async function probeSbsCombo(
  siteUrl: string,
  namespace: string,
  apiKey: string,
  authMode: AuthMode,
): Promise<{ ok: boolean; status?: number; servicesCount?: number; error?: string }> {
  let url = `${siteUrl}${namespace}/services`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (authMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`
  else if (authMode === 'x_api_key') headers['X-API-Key'] = apiKey
  else if (authMode === 'query') url += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null)

  if (!res) return { ok: false, error: 'timeout' }
  if (res.status === 404) return { ok: false, status: 404, error: 'namespace not found' }
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'auth rejected' }
  if (!res.ok) return { ok: false, status: res.status, error: `http ${res.status}` }

  let data: unknown
  try { data = await res.json() } catch { return { ok: false, error: 'response not JSON' } }
  const services = Array.isArray(data)
    ? data
    : (typeof data === 'object' && data !== null && 'data' in data
        ? (data as { data: unknown[] }).data
        : [])
  if (!Array.isArray(services)) return { ok: false, error: 'response shape unrecognised' }
  return { ok: true, servicesCount: services.length }
}

async function validateSbs(siteUrl: string, apiKey: string): Promise<SbsValidation & { hit?: SbsProbeHit }> {
  const host = new URL(siteUrl).hostname
  try {
    const lookup = await dnsLookup(host)
    if (isPrivateIp(lookup.address)) {
      return { ok: false, error: 'Site URL points to a private/loopback address' }
    }
  } catch {
    return { ok: false, error: 'Could not resolve site hostname' }
  }

  // Probe the matrix. Stop on first hit. Track the most informative failure
  // so we can give a useful error when nothing matches.
  let lastAuthError: string | null = null
  let any404 = false
  for (const namespace of SBS_NAMESPACES) {
    for (const authMode of SBS_AUTH_MODES) {
      const r = await probeSbsCombo(siteUrl, namespace, apiKey, authMode)
      if (r.ok) {
        return {
          ok: true,
          servicesFound: r.servicesCount ?? 0,
          hit: { namespace, authMode, servicesCount: r.servicesCount ?? 0 },
        }
      }
      if (r.status === 401 || r.status === 403) lastAuthError = `${namespace} (${authMode})`
      if (r.status === 404) any404 = true
    }
  }
  if (lastAuthError) {
    return {
      ok: false,
      error: 'API key rejected by Salon Booking System',
      detail:
        `Generate a fresh key at WP-Admin → Salon → Settings → API → Generate Key. ` +
        `Make sure you have Pro installed (free version has no API). Last attempt: ${lastAuthError}.`,
    }
  }
  if (any404) {
    return {
      ok: false,
      error: 'Salon Booking System REST API not found',
      detail:
        `Tried ${SBS_NAMESPACES.length} namespaces × ${SBS_AUTH_MODES.length} auth modes — all returned 404. ` +
        `Either SBS Pro is not installed on this WordPress site, or it uses an exotic configuration. ` +
        `Verify the plugin is active + Pro license is applied.`,
    }
  }
  return { ok: false, error: 'Could not validate Salon Booking System on this site' }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — connect SBS
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can connect integrations' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const siteUrlRaw = (body.siteUrl as string | undefined)?.trim()
  const apiKey = (body.apiKey as string | undefined)?.trim()

  if (!siteUrlRaw || !apiKey) {
    return NextResponse.json({ error: 'siteUrl and apiKey are required' }, { status: 400 })
  }

  const siteUrl = normaliseSiteUrl(siteUrlRaw)
  if (!siteUrl) {
    return NextResponse.json({ error: 'siteUrl must be a valid http(s) URL' }, { status: 400 })
  }

  const v = await validateSbs(siteUrl, apiKey)
  if (!v.ok) {
    return NextResponse.json({ error: v.error, detail: v.detail }, { status: 400 })
  }

  // Persist which (namespace, authMode) combo worked so the VPS adapter uses
  // the same one at runtime. Avoids the matrix-probe at every tool call.
  const credentialBlob = JSON.stringify({
    siteUrl,
    apiKey,
    namespace: v.hit?.namespace ?? '/wp-json/salon/api/v1',
    authMode: v.hit?.authMode ?? 'bearer',
    schemaVersion: 2,
  })
  const encrypted = encryptToken(credentialBlob)

  const supabase = svc()
  const { data: row, error } = await supabase
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'salon_booking_system',
        status: 'connected',
        account_name: new URL(siteUrl).hostname,
        access_token_enc: encrypted,
        refresh_token_enc: null,
        token_expires_at: null,
        scope: 'sbs_rest_api',
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'compound_pat',
          site_url: siteUrl,
          services_at_connect: v.servicesFound ?? 0,
          connected_at: new Date().toISOString(),
          connected_by: user?.email ?? null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,provider' },
    )
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await supabase.rpc('log_integration_event', {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: 'salon_booking_system',
      p_event: 'connected',
      p_payload: { site_url: siteUrl, services_at_connect: v.servicesFound ?? 0 },
      p_actor_user_id: user?.id ?? null,
    })
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'push_integration_creds',
      triggered_by: 'dashboard:sbs:connect',
      meta: { provider: 'salon_booking_system' },
    })
  } catch (e) {
    console.error('[sbs-connect] post-insert side effects failed', e)
  }

  return NextResponse.json({ ok: true, provider: 'salon_booking_system', site_url: siteUrl, services_found: v.servicesFound })
}

export async function DELETE(_req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can disconnect' }, { status: 403 })
  }

  const supabase = svc()
  const { data: row } = await supabase
    .from('integrations')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'salon_booking_system')
    .maybeSingle()

  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', 'salon_booking_system')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.id) {
    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: clientId,
        p_provider: 'salon_booking_system',
        p_event: 'disconnected',
        p_payload: {},
        p_actor_user_id: user?.id ?? null,
      })
    } catch {}
  }
  try {
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'revoke_integration_creds',
      triggered_by: 'dashboard:sbs:disconnect',
      meta: { provider: 'salon_booking_system' },
    })
  } catch {}

  return NextResponse.json({ ok: true })
}
