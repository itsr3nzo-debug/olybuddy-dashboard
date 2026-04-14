/** Shared API authentication for agent endpoints */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
  const apiKey = request.headers.get('x-api-key')

  if (!apiKey) {
    return { authenticated: false, error: 'Authentication required (x-api-key header)', status: 401 }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Method 1: Per-client API key (preferred — each agent has its own key)
  const { data: config } = await supabase
    .from('agent_config')
    .select('client_id')
    .eq('agent_api_key', apiKey)
    .single()

  if (config) {
    const clientId = config.client_id

    // If clientIdOverride provided, verify it matches the key's client
    if (clientIdOverride && clientIdOverride !== clientId) {
      return { authenticated: false, error: 'API key does not match client_id', status: 403 }
    }

    return { authenticated: true, clientId, supabase }
  }

  // Method 2: Legacy shared INTERNAL_API_KEY (backwards compatibility — DEPRECATED)
  if (INTERNAL_API_KEY && apiKey === INTERNAL_API_KEY) {
    console.warn('[api-auth] DEPRECATED: Using shared INTERNAL_API_KEY. Migrate to per-client agent_api_key.')

    const clientId = clientIdOverride ?? new URL(request.url).searchParams.get('client_id')
    if (!clientId) {
      return { authenticated: false, error: 'client_id required for legacy API key auth', status: 400 }
    }

    return { authenticated: true, clientId, supabase }
  }

  return { authenticated: false, error: 'Invalid API key', status: 401 }
}
