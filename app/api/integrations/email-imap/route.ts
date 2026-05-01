/**
 * Generic IMAP/SMTP email integration — connect handler.
 *
 * Auth: email address + email-account password. Optionally a custom IMAP host
 * (auto-derived from `mail.{domain}` for HostGator-style hosts otherwise).
 * The compound credential (emailAddress + password + imapHost + smtpHost +
 * ports) is JSON-encoded then encrypted into integrations.access_token_enc.
 *
 * Validation flow:
 *  1. Derive imapHost (default: mail.{email-domain})
 *  2. Resolve hostname; refuse if it points at a private IP (SSRF gate)
 *  3. Connect via IMAPS on 993, login, list folders, disconnect — proves auth
 *  4. Encrypt + upsert + enqueue VPS push
 *
 * SMTP is NOT validated here — many hosts allow IMAP login with an account
 * that's blocked from sending. We surface SMTP failures at send time instead,
 * which gives a clearer error message ("we can read the inbox but the host
 * blocks our outbound — contact your provider").
 *
 * Credential safety:
 *  - Plaintext password is never logged. Only emailAddress + imapHost appear
 *    in audit events.
 *  - Validation errors return upstream messages ONLY for IMAP protocol-level
 *    feedback ("authentication failed"), never raw IMAP server banners (which
 *    can leak version info).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '@/lib/encryption'
import { ImapFlow } from 'imapflow'
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

function isValidEmail(addr: string): boolean {
  // Lightweight RFC-ish check — full RFC-5322 is overkill. Just reject
  // obvious garbage so we fail fast before trying TCP.
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(addr.trim())
}

function emailDomain(addr: string): string | null {
  const m = addr.trim().match(/@([^\s@]+)$/)
  return m ? m[1].toLowerCase() : null
}

function isPrivateIp(ip: string): boolean {
  // Block private/loopback/link-local addresses + IPv4-mapped IPv6 + CGNAT.
  // Devil's-advocate finding #6 (2026-05-01): prior version missed
  // ::ffff:127.0.0.1 (IPv4-mapped IPv6 — common SSRF bypass), 100.64/10
  // (CGNAT), and a few edge cases.
  if (!ip) return true   // refuse empty
  // Strip IPv4-mapped IPv6 prefix and re-evaluate as IPv4.
  const v4mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (v4mapped) return isPrivateIp(v4mapped[1])

  if (!isIP(ip)) return true   // unknown form → refuse
  // IPv6
  if (ip === '::1' || ip === '::') return true
  if (ip.startsWith('fe80:')) return true                       // link-local
  // ULA fc00::/7 — match prefix loosely. The previous regex `/^f[cd][0-9a-f]{2}:/`
  // required exactly 2 hex chars before the colon, which silently allowed the
  // collapsed form `fc::1` (audit round 3 finding C3). startsWith is broader
  // but in this code path is also safe — there are no public addresses
  // starting with `fc` or `fd` in the IPv6 unicast range.
  const lc = ip.toLowerCase()
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true   // ULA fc00::/7
  // IPv4
  if (!ip.includes('.')) return false  // pure IPv6 not caught above is public
  const parts = ip.split('.').map(Number)
  if (parts[0] === 127) return true
  if (parts[0] === 10) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  if (parts[0] === 0) return true                                // 0.0.0.0/8
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true  // CGNAT
  if (parts[0] >= 224) return true                               // multicast + reserved
  return false
}

interface ImapValidation {
  ok: boolean
  error?: string
  detail?: string
  folderCount?: number
  resolvedImapHost?: string
}

async function validateImap(
  emailAddress: string,
  password: string,
  imapHost: string,
): Promise<ImapValidation> {
  // SSRF gate. Resolve to IP, refuse private/loopback. Resolve ALL addresses
  // (devil's-advocate #5: a malicious DNS could return one public + one
  // private; we must reject if any are private). Then PIN the public IP for
  // the actual connect so DNS rebinding can't swap it between resolution
  // and connect — imapflow.host gets the IP, TLS servername is the hostname.
  let resolved: { address: string; family: number }[]
  try {
    const { lookup: dnsLookupAll } = await import('node:dns/promises')
    resolved = await dnsLookupAll(imapHost, { all: true })
  } catch {
    return { ok: false, error: `Could not resolve IMAP server`, detail: `DNS lookup for ${imapHost} failed.` }
  }
  if (resolved.length === 0) {
    return { ok: false, error: `IMAP host returned no addresses` }
  }
  const privateAddrs = resolved.filter(r => isPrivateIp(r.address))
  if (privateAddrs.length > 0) {
    return { ok: false, error: `IMAP host resolves to a private/loopback address`, detail: `Refusing to connect to ${privateAddrs.map(r => r.address).join(', ')}.` }
  }
  // Pin the FIRST public IP — connect by IP, present the hostname for TLS SNI.
  const pinnedIp = resolved[0].address

  // imapflow connect + login + list folders. We use IMAPS (993) by default —
  // most cPanel-style hosts (HostGator, Bluehost, Namecheap) support it.
  // We do NOT try plain IMAP (143) — that would fall back to cleartext on
  // misconfigured hosts.
  const client = new ImapFlow({
    host: pinnedIp,
    port: 993,
    secure: true,
    servername: imapHost,           // TLS SNI — cert is for the hostname
    auth: { user: emailAddress, pass: password },
    logger: false,
    socketTimeout: 12_000,
  })

  try {
    await client.connect()
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (/auth|invalid credentials|login/i.test(msg)) {
      return {
        ok: false,
        error: 'Login failed — wrong email or password',
        detail:
          'Use the password for the EMAIL ACCOUNT (the one you configure in your mail client), ' +
          'not your hosting/cPanel login. If you have 2FA on the email account, generate an ' +
          'app-specific password.',
      }
    }
    return { ok: false, error: 'Could not reach IMAP server', detail: msg.slice(0, 200) }
  }

  let folderCount = 0
  try {
    const list = await client.list()
    folderCount = list.length
  } catch {
    // Some servers don't return mailbox lists for unverified clients but
    // accept the LOGIN itself. Treat that as still-ok.
    folderCount = -1
  } finally {
    try { await client.logout() } catch { /* best-effort */ }
  }

  return { ok: true, folderCount, resolvedImapHost: imapHost }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — connect email
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can connect integrations' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const emailAddress = (body.emailAddress as string | undefined)?.trim().toLowerCase()
  const password = (body.password as string | undefined)
  const imapHostRaw = (body.imapHost as string | undefined)?.trim().toLowerCase()

  if (!emailAddress || !password) {
    return NextResponse.json({ error: 'emailAddress and password are required' }, { status: 400 })
  }
  if (!isValidEmail(emailAddress)) {
    return NextResponse.json({ error: 'emailAddress is not a valid email' }, { status: 400 })
  }

  const domain = emailDomain(emailAddress)
  if (!domain) {
    return NextResponse.json({ error: 'Could not extract domain from email' }, { status: 400 })
  }

  // Auto-derive imapHost as `mail.{domain}` if not provided. Works for
  // HostGator, Bluehost, Namecheap, IONOS, most cPanel-style hosts.
  // For Google Workspace use imap.gmail.com; for Outlook outlook.office365.com.
  const imapHost = imapHostRaw && imapHostRaw.length > 0 ? imapHostRaw : `mail.${domain}`

  // Validate against the live IMAP server.
  const v = await validateImap(emailAddress, password, imapHost)
  if (!v.ok) {
    return NextResponse.json({ error: v.error, detail: v.detail }, { status: 400 })
  }

  // SMTP host defaults to the same as IMAP host — most hosts collocate them.
  // We don't probe SMTP at validate time (see header comment for why).
  const smtpHost = imapHost
  const smtpPort = 465
  const smtpSecure = true

  // Encrypt the compound credential.
  const credentialBlob = JSON.stringify({
    emailAddress,
    password,
    imapHost,
    imapPort: 993,
    smtpHost,
    smtpPort,
    smtpSecure,
    schemaVersion: 1,
  })
  const encrypted = encryptToken(credentialBlob)

  const supabase = svc()
  const { data: row, error } = await supabase
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'hostgator_email',
        status: 'connected',
        account_email: emailAddress,
        account_name: emailAddress,
        provider_user_id: emailAddress,
        access_token_enc: encrypted,
        refresh_token_enc: null,
        token_expires_at: null,
        scope: 'imap_smtp',
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'compound_pat',
          email_address: emailAddress,
          imap_host: imapHost,
          imap_port: 993,
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          folder_count: v.folderCount,
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
      p_provider: 'hostgator_email',
      p_event: 'connected',
      p_payload: { email_address: emailAddress, imap_host: imapHost, folder_count: v.folderCount },
      p_actor_user_id: user?.id ?? null,
    })
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'push_integration_creds',
      triggered_by: 'dashboard:hostgator_email:connect',
      meta: { provider: 'hostgator_email' },
    })
  } catch (e) {
    console.error('[email-imap-connect] post-insert side effects failed', e)
  }

  return NextResponse.json({
    ok: true,
    provider: 'hostgator_email',
    account_email: emailAddress,
    imap_host: imapHost,
    folder_count: v.folderCount,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — disconnect
// ──────────────────────────────────────────────────────────────────────────

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
    .eq('provider', 'hostgator_email')
    .maybeSingle()

  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', 'hostgator_email')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.id) {
    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: clientId,
        p_provider: 'hostgator_email',
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
      triggered_by: 'dashboard:hostgator_email:disconnect',
      meta: { provider: 'hostgator_email' },
    })
  } catch {}

  return NextResponse.json({ ok: true })
}
