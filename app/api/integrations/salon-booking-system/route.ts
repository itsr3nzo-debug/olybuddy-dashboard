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
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    u.pathname = '/'
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

async function validateSbs(siteUrl: string, apiKey: string): Promise<SbsValidation> {
  const host = new URL(siteUrl).hostname
  try {
    const lookup = await dnsLookup(host)
    if (isPrivateIp(lookup.address)) {
      return { ok: false, error: 'Site URL points to a private/loopback address' }
    }
  } catch {
    return { ok: false, error: 'Could not resolve site hostname' }
  }

  // Probe the plugin's namespace via /services. Plugin returns 200 with array
  // of service objects; missing plugin returns 404 (or WP REST "no route").
  const url = `${siteUrl}/wp-json/salon/api/v1/services`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)

  if (!res) {
    return { ok: false, error: 'Could not reach the site', detail: 'Request timed out.' }
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: 'API key rejected by Salon Booking System',
      detail:
        'Generate a fresh key at WP-Admin → Salon → Settings → API → Generate Key. ' +
        'Make sure you have Pro installed (the free version does not expose the REST API).',
    }
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: 'Salon Booking System REST API not found at /wp-json/salon/api/v1',
      detail:
        'Either Salon Booking System is not installed on this WordPress site, or only the ' +
        'free version is installed. The REST API requires Salon Booking System Pro.',
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `Plugin returned HTTP ${res.status}`, detail: body.slice(0, 200) }
  }

  // Sanity-check the response shape.
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: `Plugin response wasn't JSON` }
  }
  const services = Array.isArray(data) ? data : (typeof data === 'object' && data !== null && 'data' in data ? (data as { data: unknown[] }).data : [])

  return { ok: true, servicesFound: Array.isArray(services) ? services.length : 0 }
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

  const credentialBlob = JSON.stringify({ siteUrl, apiKey, schemaVersion: 1 })
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
