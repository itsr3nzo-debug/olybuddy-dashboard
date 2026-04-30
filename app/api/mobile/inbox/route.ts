/**
 * GET /api/mobile/inbox
 *
 * Lists customer↔business conversations for the mobile Inbox tab.
 *
 * Query: ?filter=all|awaiting_reply|booked|closed&cursor=<created_at>&limit=20
 *
 * Each item:
 *   { id, customer_name, customer_phone, channel, last_message_at,
 *     last_message_preview, unread_count, ai_paused, taken_over_by }
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const MAX_LIMIT = 50

let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const url = new URL(request.url)
    const filter = url.searchParams.get('filter') ?? 'all'
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, MAX_LIMIT)

    const sb = service()
    let q = sb
      .from('conversation_sessions')
      .select(
        'id, customer_name, customer_phone, channel, last_message_at, last_message_preview, unread_count, ai_paused, taken_over_by, status'
      )
      .eq('client_id', clientId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit + 1)

    switch (filter) {
      case 'awaiting_reply':
        q = q.gt('unread_count', 0)
        break
      case 'booked':
        q = q.eq('status', 'booked')
        break
      case 'closed':
        q = q.eq('status', 'closed')
        break
      // 'all' = no extra filter
    }

    if (cursor) q = q.lt('last_message_at', cursor)

    const { data, error } = await q
    if (error) return errorResponse(error, requestId)

    const rows = data ?? []
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? slice[slice.length - 1].last_message_at : null

    return jsonResponse({ items: slice, next_cursor: nextCursor }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
