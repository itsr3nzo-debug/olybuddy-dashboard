/**
 * GET /api/mobile/estimates
 * Lists estimates with filter + cursor pagination.
 *
 * Query: ?status=pending|approved|rejected&cursor=<created_at>&limit=20
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

const MAX_LIMIT = 50

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, MAX_LIMIT)

    const sb = createUntypedServiceClient()

    let q = sb
      .from('estimates')
      .select('id, contact_id, total_pence, status, line_items, notes, created_by_ai, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (status) q = q.eq('status', status)
    if (cursor) q = q.lt('created_at', cursor)

    const { data, error } = await q
    if (error) throw error

    const rows = data ?? []
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? slice[slice.length - 1].created_at : null

    return jsonResponse({ items: slice, next_cursor: nextCursor }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
