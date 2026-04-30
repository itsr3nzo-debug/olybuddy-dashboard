/**
 * GET /api/mobile/integrations
 *
 * Lists every integration provider for this client + their connection state.
 * Includes both Composio-managed and direct-OAuth providers.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    // Audit fix: live integrations table columns are created_at, last_synced_at,
    // error_message, error_count, account_email, account_name (NOT
    // connected_at / last_sync_at / last_error_at / last_error_message).
    const sb = createUntypedServiceClient()
    const { data, error } = await sb
      .from('integrations')
      .select('provider, status, account_email, account_name, created_at, last_synced_at, error_message, error_count')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false, nullsFirst: false })
    if (error) throw error
    // Project to a stable mobile-facing shape (renames internal columns to
    // the terms the mobile UI expects)
    const items = (data ?? []).map((row: Record<string, unknown>) => ({
      provider: row.provider,
      status: row.status,
      account_email: row.account_email,
      account_name: row.account_name,
      account_label: row.account_email ?? row.account_name ?? null,
      connected_at: row.created_at,
      last_sync_at: row.last_synced_at,
      last_error_at: row.error_count && (row.error_count as number) > 0 ? row.last_synced_at : null,
      last_error_message: row.error_message,
    }))
    return jsonResponse({ items }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
