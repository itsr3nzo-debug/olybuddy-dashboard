/**
 * POST /api/agent/integration/poll
 *
 * Universal integration poll proxy. Takes a provider slug + optional action
 * slug + since_iso, looks up the scanner registry entry, dispatches to
 * Composio, returns a normalised `items[]` array.
 *
 * This is the UNIVERSAL path that replaces per-provider endpoints for
 * discovery-style polling. Specialised endpoints (gmail/list, xero/invoices/*)
 * remain for provider-specific needs — this endpoint dispatches to ANY
 * registered provider generically.
 *
 * Body:
 *   {
 *     provider: "slack",              // must be in registry OR have a known composio toolkit
 *     since_iso?: "2026-04-18T00:00:00Z",
 *     override_action?: "SLACK_LIST_CONVERSATIONS"   // override registry's default
 *   }
 *
 * Returns:
 *   {
 *     provider: "slack",
 *     action_used: "SLACK_SEARCH_MESSAGES",
 *     item_count: 12,
 *     items: [ { _raw: {...}, _id: "...", _time_iso: "...", _display: "..." } ]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'
import registryJson from '@/lib/integration-scanner-registry.json'
import { z } from 'zod'

interface RegistryEntry {
  poll_action: string | string[]
  source_mode?: 'composio' | 'direct_dashboard'
  endpoints?: string[]
  merge_strategy?: 'synth_events'
  params?: Record<string, unknown>
  response_path?: string
  id_field?: string
  time_field?: string
  display_template?: string
  signal_vocabulary?: string[]
  classifier_hint?: string
  redact_fields?: string[]
  default_trust_class?: string
  trust_class_by_signal_type?: Record<string, string>
}

// Type-safe access to the registry
const REGISTRY: Record<string, RegistryEntry | unknown> = registryJson as unknown as Record<string, unknown>

// override_action allowlist — only read-only shapes. Blocks a compromised
// agent key from calling destructive Composio actions (SEND, DELETE, CREATE,
// UPDATE, PATCH, REVOKE, etc.) via this universal endpoint. Allowed verbs
// are the conventional Composio read patterns.
const READ_ONLY_ACTION = /^[A-Z0-9]+_(FETCH|LIST|SEARCH|GET|READ|RETRIEVE|COUNT|FIND|QUERY|EXPORT|VIEW|DESCRIBE|HEAD|STATUS|VERIFY)(_[A-Z0-9_]+)?$/

const PostBody = z.object({
  provider: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/),
  since_iso: z.string().optional(),
  override_action: z
    .string()
    .max(80)
    .regex(READ_ONLY_ACTION, 'override_action must be a read-only Composio action (FETCH/LIST/SEARCH/GET/etc.)')
    .optional(),
})

/** Walk a dotted path on an object, returning undefined if any step misses. */
function pluck(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj
  if (!obj || typeof obj !== 'object') return undefined
  return path
    .split('.')
    .reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key]
      }
      return undefined
    }, obj)
}

/** Fill `{placeholders}` in a template against a context. */
function fillTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => ctx[key] ?? '')
}

/** Render `display_template` like "{sender}: {subject}" against an item. */
function renderDisplay(tpl: string | undefined, item: Record<string, unknown>): string {
  if (!tpl) return ''
  return tpl.replace(/\{([^}]+)\}/g, (_, path) => {
    const val = pluck(item, path.trim())
    if (val === undefined || val === null) return ''
    return String(val).slice(0, 120)
  })
}

/** Gmail-style timestamp detection (ms vs seconds). */
function toIso(val: unknown): string {
  if (val == null) return ''
  if (typeof val === 'string') {
    const d = new Date(val)
    return isNaN(d.valueOf()) ? '' : d.toISOString()
  }
  if (typeof val === 'number') {
    const ms = val > 1e12 ? val : val * 1000
    const d = new Date(ms)
    return isNaN(d.valueOf()) ? '' : d.toISOString()
  }
  return ''
}

async function callComposio(
  action: string,
  entityId: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const res = await fetch(
    `https://backend.composio.dev/api/v3/actions/${action}/execute`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ entity_id: entityId, params }),
    },
  ).catch(e => null)
  if (!res || !res.ok) {
    return { ok: false, error: res ? `HTTP ${res.status}` : 'fetch_failed' }
  }
  try {
    const payload = await res.json()
    if (!payload.successful) {
      return { ok: false, error: payload.error ?? 'composio_unsuccessful' }
    }
    return { ok: true, data: payload.data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = PostBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { provider, since_iso, override_action } = parsed.data

  // Confirm provider is actually connected for this client
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: integration } = await sb
    .from('integrations')
    .select('provider, status')
    .eq('client_id', auth.clientId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .maybeSingle()
  if (!integration) {
    return NextResponse.json(
      { error: `${provider} not connected`, items: [], item_count: 0 },
      { status: 409 },
    )
  }

  const entry = REGISTRY[provider] as RegistryEntry | undefined
  if (!entry) {
    return NextResponse.json(
      {
        error: `no registry entry for ${provider}`,
        hint: 'Add an entry to lib/integration-scanner-registry.json. Until then, this provider is scannable only via its specialised endpoint (if any).',
        items: [],
        item_count: 0,
      },
      { status: 422 },
    )
  }

  // Direct-dashboard mode — e.g. Xero, where we already have specialised
  // /api/agent/xero/* endpoints that speak a Xero-specific schema. The
  // universal scanner defers to them.
  if (entry.source_mode === 'direct_dashboard') {
    return NextResponse.json(
      {
        error: 'use_specialised_endpoint',
        hint: `Call ${(entry.endpoints ?? []).join(' + ')} directly; universal scanner doesn't proxy these.`,
        endpoints: entry.endpoints,
        provider,
      },
      { status: 421 },
    )
  }

  // Build params — substitute known templates like {unix_seconds}, {since_date}, etc.
  const nowIso = new Date().toISOString()
  const in24hIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const sinceDate = since_iso ? new Date(since_iso) : null
  const unixSeconds = sinceDate && !isNaN(sinceDate.valueOf()) ? Math.floor(sinceDate.getTime() / 1000) : null
  const sinceDateStr = sinceDate && !isNaN(sinceDate.valueOf()) ? sinceDate.toISOString().slice(0, 10) : ''

  const substitutedParams: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(entry.params ?? {})) {
    if (typeof v === 'string' && v.includes('{')) {
      substitutedParams[k] = fillTemplate(v, {
        now_iso: nowIso,
        in_24h_iso: in24hIso,
        unix_seconds: unixSeconds ? String(unixSeconds) : '',
        since_iso: since_iso ?? '',
        since_date: sinceDateStr,
      })
    } else if (typeof v === 'string' && k.endsWith('_template')) {
      // suffix-based template keys: `query_template` → `query`
      const realKey = k.replace(/_template$/, '')
      substitutedParams[realKey] = fillTemplate(v, {
        now_iso: nowIso,
        in_24h_iso: in24hIso,
        unix_seconds: unixSeconds ? String(unixSeconds) : '',
        since_iso: since_iso ?? '',
        since_date: sinceDateStr,
        since_filter: unixSeconds
          ? fillTemplate((entry.params?.since_filter_format as string) ?? '', { unix_seconds: String(unixSeconds) })
          : '',
      })
    } else {
      substitutedParams[k] = v
    }
  }
  // Strip internal template-support fields
  delete substitutedParams.query_template
  delete substitutedParams.since_filter_format

  // Determine action(s) to call
  const actions = override_action
    ? [override_action]
    : Array.isArray(entry.poll_action)
      ? entry.poll_action
      : [entry.poll_action]

  // Call all actions in parallel (e.g. Stripe's 5 resource lists)
  const results = await Promise.all(
    actions.map(a => callComposio(a, auth.clientId, substitutedParams)),
  )

  const rawItems: Array<Record<string, unknown>> = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (!r.ok) continue
    const items = pluck(r.data, entry.response_path)
    if (Array.isArray(items)) {
      for (const it of items) {
        if (it && typeof it === 'object') {
          rawItems.push({ ...(it as Record<string, unknown>), _source_action: actions[i] })
        }
      }
    }
  }

  // Normalise each item into the universal shape
  const items = rawItems.slice(0, 50).map(item => {
    const id = String(pluck(item, entry.id_field) ?? '')
    const time = pluck(item, entry.time_field)
    return {
      _id: id,
      _time_iso: toIso(time),
      _display: renderDisplay(entry.display_template, item),
      _source_action: item._source_action,
      _raw: item,
    }
  }).filter(it => it._id)

  return NextResponse.json({
    provider,
    actions_used: actions,
    item_count: items.length,
    items,
    classifier_hint: entry.classifier_hint,
    signal_vocabulary: entry.signal_vocabulary,
    default_trust_class: entry.default_trust_class,
    trust_class_by_signal_type: entry.trust_class_by_signal_type ?? {},
    redact_fields: entry.redact_fields ?? [],
  })
}

/** GET — introspect the registry. Handy for the scanner to know which
 * providers it can poll universally. */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const providers = Object.keys(REGISTRY)
    .filter(k => !k.startsWith('_'))
    .map(k => {
      const e = REGISTRY[k] as RegistryEntry
      return {
        provider: k,
        has_universal_scanner: e.source_mode !== 'direct_dashboard',
        poll_actions: Array.isArray(e.poll_action) ? e.poll_action : [e.poll_action],
        signal_vocabulary: e.signal_vocabulary ?? [],
      }
    })

  return NextResponse.json({ count: providers.length, providers })
}
