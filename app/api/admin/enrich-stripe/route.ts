/**
 * POST /api/admin/enrich-stripe
 *
 * One-shot backfill for existing Stripe connections that were made BEFORE the
 * OAuth callback started enriching metadata.stripe_account_id. For each
 * Stripe integration without a persisted stripe_account_id, call Composio's
 * connected_accounts/get to pull the account data + defensively extract the
 * acct_* id from known paths.
 *
 * Super-admin only. Safe to re-run — skips rows that already have the id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'

interface IntegrationRow {
  id: string
  client_id: string
  metadata: Record<string, unknown> | null
}

interface ComposioAccountResponse {
  data?: {
    user?: { email?: string }
    auth_config_data?: Record<string, unknown>
    state?: { val?: Record<string, unknown> }
    connection_data?: Record<string, unknown>
    [k: string]: unknown
  }
  status?: string
}

function extractStripeAcct(conn: ComposioAccountResponse): string | null {
  const candidates: Array<Record<string, unknown> | undefined> = [
    conn.data,
    conn.data?.auth_config_data,
    conn.data?.state?.val,
    conn.data?.connection_data,
  ]
  for (const c of candidates) {
    if (!c) continue
    const val =
      (c.stripe_account_id as string | undefined) ??
      (c.account_id as string | undefined) ??
      (c.stripe_user_id as string | undefined)
    if (typeof val === 'string' && val.startsWith('acct_')) return val
  }
  return null
}

export async function POST(req: NextRequest) {
  // Super-admin gate via dashboard session
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {},
      },
    },
  )
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  if (user.app_metadata?.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin only' }, { status: 403 })
  }

  const svc = createServiceClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Fetch all connected Stripe integrations
  const { data: rows, error } = await svc
    .from('integrations')
    .select('id, client_id, metadata')
    .eq('provider', 'stripe')
    .eq('status', 'connected')

  if (error) {
    return NextResponse.json({ error: 'query failed', detail: error.message }, { status: 500 })
  }

  const report: Array<{
    client_id: string
    already_enriched?: boolean
    enriched?: string
    skipped?: string
    error?: string
  }> = []

  for (const row of (rows ?? []) as IntegrationRow[]) {
    const meta = row.metadata ?? {}
    const existingAcct = meta.stripe_account_id as string | undefined
    if (existingAcct) {
      report.push({ client_id: row.client_id, already_enriched: true })
      continue
    }
    const connectionId = meta.composio_connected_account_id as string | undefined
    if (!connectionId) {
      report.push({ client_id: row.client_id, skipped: 'no composio_connected_account_id' })
      continue
    }

    // Fetch the connection from Composio
    const composioRes = await fetch(
      `https://backend.composio.dev/api/v3/connected_accounts/${connectionId}`,
      { headers: { 'x-api-key': process.env.COMPOSIO_API_KEY! } },
    ).catch(e => ({ ok: false, error: e } as { ok: false; error: unknown }))

    if (!('ok' in composioRes) || !composioRes.ok) {
      report.push({ client_id: row.client_id, error: 'composio fetch failed' })
      continue
    }

    const conn = (await composioRes.json()) as ComposioAccountResponse
    const acct = extractStripeAcct(conn)
    if (!acct) {
      report.push({ client_id: row.client_id, skipped: 'no acct_* id found in response' })
      continue
    }

    const { error: upErr } = await svc
      .from('integrations')
      .update({ metadata: { ...meta, stripe_account_id: acct } })
      .eq('id', row.id)

    if (upErr) {
      report.push({ client_id: row.client_id, error: `update failed: ${upErr.message}` })
    } else {
      report.push({ client_id: row.client_id, enriched: acct })
    }
  }

  return NextResponse.json({
    total: (rows ?? []).length,
    enriched: report.filter(r => r.enriched).length,
    already_enriched: report.filter(r => r.already_enriched).length,
    skipped: report.filter(r => r.skipped).length,
    failed: report.filter(r => r.error).length,
    report,
  })
}
