/**
 * POST /api/mobile/integrations/[provider]/connect
 *
 * Mobile-friendly OAuth init. Returns the OAuth URL as JSON instead of
 * redirecting (the mobile app opens it in WebBrowser / a sheet, not the
 * current page).
 *
 * For Composio-managed providers (Gmail, Calendar, Slack, HubSpot, etc):
 *   1. Auth user via JWT
 *   2. Call composio.connectedAccounts.initiate({ userId, authConfigId, callbackUrl })
 *   3. Return { url, connection_id, expires_at }
 *
 * For direct OAuth providers (Xero, Sage, FreeAgent):
 *   1. Generate state cookie
 *   2. Build provider OAuth URL
 *   3. Return { url, state }
 *
 * The callback path (/api/oauth/[provider]/callback) is unchanged from the
 * web flow — it writes to integrations table on success.
 */

import { NextRequest } from 'next/server'
import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'

export const runtime = 'nodejs'
export const maxDuration = 30

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
      throw Errors.forbidden('Only owners can connect integrations.')
    }

    const origin = new URL(request.url).origin

    // Lazy-import to avoid pulling Composio into routes that don't need it
    const { getComposioProvider, composio } = await import('@/lib/composio')
    const composioCfg = getComposioProvider(provider)

    if (composioCfg) {
      try {
        const callbackUrl = `${origin}/api/oauth/${provider}/callback?from=mobile`
        const connection = await composio.connectedAccounts.initiate(
          clientId,
          composioCfg.authConfigId,
          { callbackUrl, allowMultiple: true }
        )
        return jsonResponse(
          {
            url: connection.redirectUrl,
            connection_id: connection.id,
            provider,
          },
          { requestId }
        )
      } catch (err) {
        console.error(`[mobile/integrations/connect] composio init failed for ${provider}:`, err)
        throw Errors.internal('Could not start the connect flow. Try again in a moment.')
      }
    }

    // Direct OAuth providers (Xero etc) — fall back to the existing /api/oauth/[provider]
    // GET route, which builds the URL itself. We just return a URL the mobile app
    // opens in WebBrowser; the callback after auth completes lands in our database.
    const directUrl = `${origin}/api/oauth/${provider}?from=mobile&state_user=${encodeURIComponent(claims.sub)}`
    return jsonResponse(
      {
        url: directUrl,
        provider,
        kind: 'direct',
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
