/**
 * POST /api/integrations/pat
 *
 * For Personal-Access-Token-style integrations (Fergus today, future: anything
 * that gives the user a long-lived API key instead of OAuth).
 *
 * Flow:
 *  1. User clicks Connect on a `pat`-configured provider in /integrations
 *  2. Dashboard shows a modal asking for the token
 *  3. Modal POSTs here with { provider, token }
 *  4. We call provider.pat.validateUrl with Authorization: Bearer <token> to confirm it works
 *  5. Encrypt + store in `integrations` table with provider + metadata
 *
 * DELETE /api/integrations/pat?provider=fergus — disconnects (row status → disconnected).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { PROVIDERS } from '@/lib/integrations-config'
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

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can connect integrations' }, { status: 403 })
  }

  const { provider: providerId, token, accountName } = await req.json().catch(() => ({}))
  if (!providerId || !token) {
    return NextResponse.json({ error: 'provider and token required' }, { status: 400 })
  }

  const provider = PROVIDERS.find(p => p.id === providerId)
  if (!provider?.pat) {
    return NextResponse.json({ error: `Provider ${providerId} doesn't support PAT auth` }, { status: 400 })
  }

  // Validate the token against the provider's canary endpoint
  let validated = true
  let validationInfo: { email?: string; name?: string } = {}
  if (provider.pat.validateUrl) {
    try {
      const res = await fetch(provider.pat.validateUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return NextResponse.json(
          { error: `Token validation failed — ${provider.name} returned ${res.status}`, detail: body.slice(0, 200) },
          { status: 400 },
        )
      }
      const body: Record<string, unknown> = await res.json().catch(() => ({}))
      validationInfo = {
        email: (body.email as string) ?? (body as { user?: { email?: string } })?.user?.email ?? undefined,
        name: (body.name as string) ?? (body as { user?: { name?: string } })?.user?.name ?? undefined,
      }
    } catch (e) {
      return NextResponse.json(
        { error: 'Validation call to provider failed', detail: String(e) },
        { status: 502 },
      )
    }
  } else {
    validated = false // no validation endpoint → accept-trust
  }

  // Encrypt + upsert
  const supabase = svc()
  const { error } = await supabase
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: providerId,
        status: 'connected',
        account_email: validationInfo.email ?? null,
        account_name: accountName ?? validationInfo.name ?? provider.name,
        access_token_enc: encryptToken(token),
        refresh_token_enc: null,
        token_expires_at: null,
        scope: 'pat',
        metadata: { auth_mode: 'pat', validated, connected_at: new Date().toISOString(), connected_by: user?.email ?? null },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,provider' },
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // When a client connects Fergus (or Xero — though Xero is OAuth, not PAT),
  // enqueue a push of the integration skill files to that client's VPS so
  // their AI Employee picks up the latest fergus.md / xero.md playbook on
  // the next service restart. Idempotent — re-running just rewrites identical
  // files. Best-effort: if the queue insert fails, the connect still succeeds;
  // the operator can run push-integration-skills-to-fleet.sh manually.
  if (providerId === 'fergus' || providerId === 'xero') {
    try {
      await supabase.from('provisioning_queue').insert({
        client_id: clientId,
        action: 'push_integration_skills',
        triggered_by: `dashboard:pat-connect:${providerId}`,
        meta: { provider: providerId, validated },
      })
    } catch (e) {
      console.error('[pat-connect] failed to enqueue skill push:', e)
    }
  }

  return NextResponse.json({
    ok: true,
    provider: providerId,
    account_name: validationInfo.name ?? null,
    account_email: validationInfo.email ?? null,
    validated,
  })
}

export async function DELETE(req: NextRequest) {
  const { clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can disconnect' }, { status: 403 })
  }

  const providerId = new URL(req.url).searchParams.get('provider')
  if (!providerId) return NextResponse.json({ error: 'provider required' }, { status: 400 })

  const supabase = svc()
  const { error } = await supabase
    .from('integrations')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('provider', providerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
