/** Shared API authentication for agent endpoints */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSupabase = SupabaseClient<any, any, any>

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export type AuthResult =
  | { authenticated: true; clientId: string; supabase: UntypedSupabase }
  | { authenticated: false; error: string; status: number }

/** Constant-time string comparison */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** UUID v4 format check */
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

/**
 * Authenticate an agent API request.
 * Uses x-api-key header (for agents) — requires client_id in query param or body.
 * Validates client_id exists in the database to prevent operating on phantom clients.
 */
export async function authenticateAgentRequest(
  request: Request,
  clientIdOverride?: string
): Promise<AuthResult> {
  const apiKey = request.headers.get('x-api-key')

  if (apiKey) {
    if (!INTERNAL_API_KEY || !safeCompare(apiKey, INTERNAL_API_KEY)) {
      return { authenticated: false, error: 'Invalid API key', status: 401 }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // client_id must be provided (agents operate on behalf of a client)
    const clientId = clientIdOverride ?? new URL(request.url).searchParams.get('client_id')
    if (!clientId) {
      return { authenticated: false, error: 'client_id required for API key auth', status: 400 }
    }

    // Validate UUID format
    if (!isValidUuid(clientId)) {
      return { authenticated: false, error: 'Invalid client_id format', status: 400 }
    }

    // Verify client actually exists in the database
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (clientErr || !client) {
      return { authenticated: false, error: 'Client not found', status: 404 }
    }

    return { authenticated: true, clientId, supabase }
  }

  return { authenticated: false, error: 'Authentication required (x-api-key header)', status: 401 }
}
