/**
 * GET /api/mobile/notifications
 *
 * Returns the user's notification history (in-app inbox).
 *
 * Query: ?cursor=<id>&limit=50
 * Response: { items: Notification[], next_cursor: string|null, unread_total: number }
 */

import { requireAuth } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const MAX_LIMIT = 100

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)

    const url = new URL(request.url)
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, MAX_LIMIT)

    const sb = createUntypedServiceClient()

    let q = sb
      .from('notifications')
      .select('id, category, title, body, deep_link, data, read_at, created_at')
      .eq('user_id', claims.sub)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // ask for +1 to know if there's a next page

    if (cursor) {
      // Cursor encodes created_at; decode and filter
      q = q.lt('created_at', cursor)
    }

    const [items, unread] = await Promise.all([
      q,
      sb
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', claims.sub)
        .is('read_at', null),
    ])

    if (items.error) throw items.error

    const rows = items.data ?? []
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? slice[slice.length - 1].created_at : null

    return jsonResponse(
      {
        items: slice,
        next_cursor: nextCursor,
        unread_total: unread.count ?? 0,
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
