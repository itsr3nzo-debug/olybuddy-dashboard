import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Admin/service-role client — used by API routes and webhooks
// This bypasses RLS and has full access to all data
let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}
