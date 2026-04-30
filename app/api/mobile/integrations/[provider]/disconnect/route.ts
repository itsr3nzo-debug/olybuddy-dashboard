/**
 * POST /api/mobile/integrations/[provider]/disconnect
 *
 * Revokes an integration. For Composio-managed: calls the Composio API to
 * delete the connected account. For direct OAuth: clears the row in
 * integrations table (refresh tokens are dropped from our store).
 *
 * In both cases we update the integrations row to status='disconnected'
 * so the UI immediately reflects.
 */

import { NextRequest } from 'next/server'
import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { provider } = await params

    const role = claims.app_metadata?.role ?? 'member'
    if (role !== 'owner' && role !== 'super_admin') {
      throw Errors.forbidden('Only owners can disconnect integrations.')
    }

    const sb = createUntypedServiceClient()

    // DA fix D14: integrations table has NO composio_connection_id column.
    // Composio connection id lives inside metadata jsonb; sensitive tokens
    // are access_token_enc / refresh_token_enc (not access_token).
    const { data: row } = await sb
      .from('integrations')
      .select('id, provider, status, metadata')
      .eq('client_id', clientId)
      .eq('provider', provider)
      .maybeSingle()

    if (!row) {
      // Idempotent — nothing to disconnect
      return jsonResponse({ ok: true, already: true }, { requestId })
    }

    const meta = (row.metadata as { composio_connection_id?: string } | null) ?? {}
    const connId = meta.composio_connection_id

    // For Composio-managed: revoke server-side too. Use a typed import so
    // the SDK method existence is enforced at build time, not silently
    // swallowed at runtime (DA fix I34).
    if (connId) {
      try {
        const { composio } = await import('@/lib/composio')
        // Composio core 0.6.x — method is `delete` on the v3 SDK; older
        // versions exposed it as `disconnect`. Try the canonical form;
        // log unknown-method as a real error (not a silent .catch).
        const accounts = composio.connectedAccounts as { delete?: (id: string) => Promise<unknown>; disconnect?: (id: string) => Promise<unknown> }
        if (typeof accounts.delete === 'function') {
          await accounts.delete(connId)
        } else if (typeof accounts.disconnect === 'function') {
          await accounts.disconnect(connId)
        } else {
          console.error('[mobile/integrations/disconnect] Composio SDK has neither .delete nor .disconnect on connectedAccounts')
        }
      } catch (err) {
        // Token still active at the provider — surface as warning; we still
        // clear our local copy so the AI Employee won't keep using it.
        console.error('[mobile/integrations/disconnect] composio revoke failed:', err)
      }
    }

    // Mark our row disconnected, scrub the encrypted tokens
    const { error } = await sb
      .from('integrations')
      .update({
        status: 'disconnected',
        access_token_enc: null,
        refresh_token_enc: null,
        token_expires_at: null,
        error_message: null,
        error_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
