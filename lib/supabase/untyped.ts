/**
 * Untyped Supabase service-role client.
 *
 * The dashboard has strict generated Database types that don't include new
 * mobile-backend tables (api_idempotency, jwt_denylist, push_subscriptions,
 * notifications, etc.). Re-generating types is a separate task; in the
 * interim, use this helper for any code that touches mobile tables.
 *
 * Pattern matches `UntypedSupabase` from lib/api-auth.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSupabase = SupabaseClient<any, any, any>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

let _instance: UntypedSupabase | null = null

/**
 * Lazy singleton service-role client. Untyped — accept any table name without
 * the compiler complaining about missing schema.
 */
export function getServiceClient(): UntypedSupabase {
  if (!_instance) {
    _instance = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as UntypedSupabase
  }
  return _instance
}

/**
 * Build a fresh untyped service client. Prefer `getServiceClient()` unless
 * you specifically need an isolated instance.
 */
export function createUntypedServiceClient(): UntypedSupabase {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as UntypedSupabase
}
