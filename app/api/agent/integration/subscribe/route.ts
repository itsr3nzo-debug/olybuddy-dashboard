/**
 * POST /api/agent/integration/subscribe
 *
 * Creates (or refreshes) a Composio trigger subscription for this client's
 * connected integration. Under the hood this calls
 *   POST /api/v3/trigger_instances/{trigger_slug}/upsert
 * with body { connected_account_id, trigger_config } — which is idempotent per
 * (connected_account, trigger_slug).
 *
 * Once subscribed, Composio POSTs events to our global webhook (the one
 * configured in the Composio dashboard, handled by /api/webhooks/composio).
 *
 * Body:
 *   {
 *     provider: "gmail",
 *     trigger_slugs: ["GMAIL_NEW_GMAIL_MESSAGE"],   // one or more
 *     trigger_config?: { ...per-trigger settings... } // optional
 *   }
 *
 * DELETE /api/agent/integration/subscribe?trigger_id=...  — unsubscribe.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const PostBody = z.object({
  provider: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/),
  trigger_slugs: z.array(z.string().min(3).max(80).regex(/^[A-Z0-9_]+$/)).min(1).max(20),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
})

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function composioUpsert(triggerSlug: string, connectedAccountId: string, triggerConfig?: Record<string, unknown>) {
  const res = await fetch(
    `https://backend.composio.dev/api/v3/trigger_instances/${triggerSlug}/upsert`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        connected_account_id: connectedAccountId,
        trigger_config: triggerConfig ?? {},
      }),
    },
  )
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const parsed = PostBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const { provider, trigger_slugs, trigger_config } = parsed.data

  const sb = svc()
  const { data: integration } = await sb
    .from('integrations')
    .select('metadata, status')
    .eq('client_id', auth.clientId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .maybeSingle()

  if (!integration) {
    return NextResponse.json({ error: `${provider} not connected for this client` }, { status: 409 })
  }
  const connectedAccountId =
    (integration.metadata as Record<string, unknown> | null)?.composio_connected_account_id as string | undefined
  if (!connectedAccountId) {
    return NextResponse.json(
      { error: 'integration has no composio_connected_account_id — reconnect via OAuth' },
      { status: 422 },
    )
  }

  if (!process.env.COMPOSIO_API_KEY) {
    return NextResponse.json({ error: 'COMPOSIO_API_KEY not configured' }, { status: 501 })
  }

  // Subscribe all requested triggers in parallel
  const results = await Promise.all(
    trigger_slugs.map(async slug => {
      const { status, body } = await composioUpsert(slug, connectedAccountId, trigger_config)
      return {
        trigger_slug: slug,
        ok: status >= 200 && status < 300,
        http_status: status,
        trigger_id: (body as { trigger_id?: string })?.trigger_id,
        error: status >= 400 ? (body as { error?: unknown })?.error ?? body : undefined,
      }
    }),
  )

  return NextResponse.json({
    provider,
    connected_account_id: connectedAccountId,
    subscriptions: results,
    ok: results.every(r => r.ok),
  })
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const triggerId = new URL(req.url).searchParams.get('trigger_id')
  if (!triggerId || !/^[a-zA-Z0-9_-]{5,80}$/.test(triggerId)) {
    return NextResponse.json({ error: 'trigger_id query param required' }, { status: 400 })
  }
  if (!process.env.COMPOSIO_API_KEY) {
    return NextResponse.json({ error: 'COMPOSIO_API_KEY not configured' }, { status: 501 })
  }

  // Tenant-isolation: confirm trigger_id belongs to one of THIS client's
  // connected accounts. Otherwise a compromised agent key could delete
  // another tenant's subscriptions (trigger_ids are discoverable).
  const sb = svc()
  const { data: integrations } = await sb
    .from('integrations')
    .select('metadata')
    .eq('client_id', auth.clientId)
    .eq('status', 'connected')
  const clientAccountIds = new Set(
    (integrations ?? [])
      .map(i => (i.metadata as Record<string, unknown> | null)?.composio_connected_account_id as string | undefined)
      .filter((x): x is string => Boolean(x)),
  )
  if (clientAccountIds.size === 0) {
    return NextResponse.json({ error: 'no connected accounts for this client' }, { status: 404 })
  }

  // Look up the trigger's owning connected_account_id via Composio's read API.
  const lookupRes = await fetch(
    `https://backend.composio.dev/api/v3/trigger_instances/active?limit=200`,
    { headers: { 'x-api-key': process.env.COMPOSIO_API_KEY! } },
  )
  if (!lookupRes.ok) {
    return NextResponse.json({ error: 'trigger_lookup_failed' }, { status: 502 })
  }
  const lookupBody = (await lookupRes.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; connected_account_id?: string }>
  }
  const match = (lookupBody.items ?? []).find(i => i.id === triggerId)
  if (!match) {
    return NextResponse.json({ error: 'trigger not found' }, { status: 404 })
  }
  if (!match.connected_account_id || !clientAccountIds.has(match.connected_account_id)) {
    // Do NOT confirm whether it exists for another tenant (enumeration). Return 404.
    return NextResponse.json({ error: 'trigger not found' }, { status: 404 })
  }

  const res = await fetch(
    `https://backend.composio.dev/api/v3/trigger_instances/manage/${triggerId}`,
    {
      method: 'DELETE',
      headers: { 'x-api-key': process.env.COMPOSIO_API_KEY! },
    },
  )
  const body = await res.json().catch(() => ({}))
  return NextResponse.json({ ok: res.ok, http_status: res.status, body }, { status: res.ok ? 200 : res.status })
}

/** GET — list active trigger subscriptions for this client. */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const provider = new URL(req.url).searchParams.get('provider')
  const sb = svc()
  let q = sb.from('integrations').select('provider, metadata').eq('client_id', auth.clientId).eq('status', 'connected')
  if (provider) q = q.eq('provider', provider)
  const { data: integrations } = await q

  const accountIds = (integrations ?? [])
    .map(i => (i.metadata as Record<string, unknown> | null)?.composio_connected_account_id as string | undefined)
    .filter((x): x is string => Boolean(x))

  if (!accountIds.length) return NextResponse.json({ count: 0, instances: [] })

  const query = new URLSearchParams()
  for (const id of accountIds) query.append('connected_account_ids[]', id)

  const res = await fetch(`https://backend.composio.dev/api/v3/trigger_instances/active?${query}`, {
    headers: { 'x-api-key': process.env.COMPOSIO_API_KEY! },
  })
  const body = await res.json().catch(() => ({}))
  return NextResponse.json(body, { status: res.ok ? 200 : res.status })
}
