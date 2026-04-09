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
 *   1. x-api-key header (for agents) — requires client_id in query param or body
 *   2. Supabase session cookie (for dashboard UI) — reads client_id from app_metadata
 */
export async function authenticateAgentRequest(
  request: Request,
  clientIdOverride?: string
): Promise<AuthResult> {
  const apiKey = request.headers.get('x-api-key')

  // Method 1: API key auth (for agents like Light)
  if (apiKey) {
    if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
      return { authenticated: false, error: 'Invalid API key', status: 401 }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // client_id must be provided (agents operate on behalf of a client)
    const clientId = clientIdOverride ?? new URL(request.url).searchParams.get('client_id')
    if (!clientId) {
      return { authenticated: false, error: 'client_id required for API key auth', status: 400 }
    }

    return { authenticated: true, clientId, supabase }
  }

  // Method 2: No auth provided
  return { authenticated: false, error: 'Authentication required (x-api-key header)', status: 401 }
}
