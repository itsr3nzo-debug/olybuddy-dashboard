/**
 * GET /api/mobile/jobs
 *
 * Pipeline view — lists deals/jobs across stages (quoted/booked/completed).
 * Reads from `opportunities` (existing CRM table) joined with summary stats.
 *
 * Query: ?stage=quoted|booked|completed&cursor=<created_at>&limit=20
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
    const stage = url.searchParams.get('stage')
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, MAX_LIMIT)

    const sb = createUntypedServiceClient()

    let q = sb
      .from('opportunities')
      .select('id, title, stage, value_pence, contact_id, created_at, updated_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)
    if (stage) q = q.eq('stage', stage)
    if (cursor) q = q.lt('created_at', cursor)

    // Aggregate totals per stage in parallel
    const [items, totals] = await Promise.all([
      q,
      sb
        .from('opportunities')
        .select('stage, value_pence')
        .eq('client_id', clientId),
    ])

    if (items.error) throw items.error

    const sums = { quoted_pence: 0, booked_pence: 0, completed_pence: 0 }
    for (const o of (totals.data ?? []) as Array<{ stage?: string; value_pence?: number }>) {
      const v = o.value_pence ?? 0
      if (o.stage === 'quoted') sums.quoted_pence += v
      else if (o.stage === 'booked') sums.booked_pence += v
      else if (o.stage === 'completed') sums.completed_pence += v
    }

    const rows = items.data ?? []
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? slice[slice.length - 1].created_at : null

    return jsonResponse({ items: slice, totals: sums, next_cursor: nextCursor }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
