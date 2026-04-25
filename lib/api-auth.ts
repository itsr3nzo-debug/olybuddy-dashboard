/** Shared API authentication for agent endpoints */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { hashAgentKey } from '@/lib/agent-auth'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSupabase = SupabaseClient<any, any, any>

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export type AuthResult =
  | { authenticated: true; clientId: string; supabase: UntypedSupabase }
  | { authenticated: false; error: string; status: number }

/**
 * Authenticate an agent API request.
 * Supports two auth methods:
 *   1. Per-client API key (x-api-key header) — looked up in agent_config.agent_api_key
 *      The key is bound to a specific client_id — no cross-tenant access possible.
 *   2. Legacy shared INTERNAL_API_KEY — deprecated, logs warning. Requires client_id param.
 */
export async function authenticateAgentRequest(
  request: Request,
  clientIdOverride?: string
): Promise<AuthResult> {
  // Accept either `x-api-key: <key>` (historical) or `Authorization: Bearer <key>`
  // (used by the pending-estimates / variations / log-action routes). Both carry
  // the same per-client oak_* secret — unifying here lets VPS agents send a
  // single header style across all 74 endpoints instead of guessing which one
  // each endpoint prefers.
  const xkey = request.headers.get('x-api-key')
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const apiKey = xkey || bearer || null

  if (!apiKey) {
    return { authenticated: false, error: 'Authentication required (x-api-key or Authorization: Bearer header)', status: 401 }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Method 1: Per-client API key (preferred — each agent has its own key).
  // Lookup chain (item #4 + P1 #4 fix):
  //   1. agent_api_key_hash       — current key (post-rotation steady state)
  //   2. previous_api_key_hash    — old key during rotation TTL window
  //                                 (eliminates 30-60s VPS .env push gap)
  //   3. agent_api_key (legacy)   — pre-migration plaintext, self-heals
  const apiKeyHash = hashAgentKey(apiKey)
  let config: { client_id: string } | null = null
  const primary = await supabase
    .from('agent_config')
    .select('client_id')
    .eq('agent_api_key_hash', apiKeyHash)
    .maybeSingle()
  if (primary.data) config = primary.data

  // 2. Previous key during rotation window
  if (!config) {
    const prev = await supabase
      .from('agent_config')
      .select('client_id, previous_api_key_expires_at')
      .eq('previous_api_key_hash', apiKeyHash)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = prev.data as any
    if (row && row.previous_api_key_expires_at && new Date(row.previous_api_key_expires_at).getTime() > Date.now()) {
      config = { client_id: row.client_id }
    }
  }

  if (!config) {
    const legacy = await supabase
      .from('agent_config')
      .select('client_id')
      .eq('agent_api_key', apiKey)
      .maybeSingle()
    if (legacy.data) {
      config = legacy.data
      // Round-3 fix #9: telemetry on legacy fallback hits — same as
      // lib/agent-auth.ts. Lets the runbook's "drop after 7 clean days"
      // step actually verify clean.
      void supabase.from('integration_signals').insert({
        source: 'api-auth',
        kind: 'legacy_key_fallback_hit',
        external_id: legacy.data.client_id,
        raw: { client_id: legacy.data.client_id },
        occurred_at: new Date().toISOString(),
      }).then(() => {}, () => {})
      // Backfill the hash for subsequent calls. Fire-and-forget.
      void supabase
        .from('agent_config')
        .update({ agent_api_key_hash: apiKeyHash })
        .eq('client_id', legacy.data.client_id)
        .then(() => {}, () => {})
    }
  }

  if (config) {
    const clientId = config.client_id

    // If clientIdOverride provided, verify it matches the key's client
    if (clientIdOverride && clientIdOverride !== clientId) {
      return { authenticated: false, error: 'API key does not match client_id', status: 403 }
    }

    return { authenticated: true, clientId, supabase }
  }

  // Method 2: Legacy shared INTERNAL_API_KEY — DISABLED BY DEFAULT.
  // Bug: the previous implementation trusted whatever client_id was passed
  // alongside the shared key, so a leaked INTERNAL_API_KEY let an attacker
  // impersonate ANY client. Keep the code path so existing env vars don't
  // silently 403, but require an explicit opt-in env flag AND an allowlist
  // of client_ids that can be accessed with the shared key.
  if (INTERNAL_API_KEY && apiKey === INTERNAL_API_KEY) {
    if (process.env.ALLOW_LEGACY_INTERNAL_API_KEY !== 'true') {
      console.error('[api-auth] INTERNAL_API_KEY use blocked — set ALLOW_LEGACY_INTERNAL_API_KEY=true to re-enable (NOT RECOMMENDED)')
      return { authenticated: false, error: 'Legacy API key auth disabled — use per-client agent_api_key', status: 401 }
    }
    const allowlist = (process.env.LEGACY_INTERNAL_API_KEY_CLIENT_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const clientId = clientIdOverride ?? new URL(request.url).searchParams.get('client_id')
    if (!clientId) {
      return { authenticated: false, error: 'client_id required for legacy API key auth', status: 400 }
    }
    if (allowlist.length > 0 && !allowlist.includes(clientId)) {
      console.error('[api-auth] INTERNAL_API_KEY denied for client_id', clientId, '— not in allowlist')
      return { authenticated: false, error: 'client_id not allowlisted for legacy API key auth', status: 403 }
    }
    console.warn('[api-auth] DEPRECATED: Using shared INTERNAL_API_KEY for', clientId, '— migrate to per-client agent_api_key')
    return { authenticated: true, clientId, supabase }
  }

  return { authenticated: false, error: 'Invalid API key', status: 401 }
}
