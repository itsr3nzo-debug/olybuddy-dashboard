/**
 * GET /api/mobile/contacts
 *
 * Customer directory list with search + cursor pagination.
 * Query: ?search=...&cursor=<last_name>&limit=50
 *
 * Schema (verified live 2026-04-29):
 *   contacts has first_name + last_name (no `name`), phone + whatsapp,
 *   email, last_contacted (no `_at` suffix), custom_fields (no `notes`).
 *   We project a `display_name` field for the mobile UI.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

const MAX_LIMIT = 100

let _sb: import('@/lib/supabase/untyped').UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

interface ContactRow {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  last_contacted: string | null
  created_at: string | null
  custom_fields: Record<string, unknown> | null
}

function displayName(c: ContactRow): string {
  const parts = [c.first_name, c.last_name].filter(Boolean)
  return parts.join(' ') || c.email || c.phone || c.whatsapp || 'Unknown'
}

export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const url = new URL(request.url)
    const search = url.searchParams.get('search')
    const cursor = url.searchParams.get('cursor')
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, MAX_LIMIT)

    let q = service()
      .from('contacts')
      .select('id, first_name, last_name, phone, whatsapp, email, last_contacted, created_at, custom_fields')
      .eq('client_id', clientId)
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('first_name', { ascending: true, nullsFirst: false })
      .limit(limit + 1)

    if (search && search.length > 0) {
      const safe = search.replace(/[%_]/g, '\\$&')
      q = q.or(
        `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone.ilike.%${safe}%,whatsapp.ilike.%${safe}%,email.ilike.%${safe}%`
      )
    }
    if (cursor) q = q.gt('last_name', cursor)

    const { data, error } = await q
    if (error) throw error

    const rows = (data ?? []) as ContactRow[]
    const hasMore = rows.length > limit
    const slice = hasMore ? rows.slice(0, limit) : rows
    const items = slice.map((c) => ({
      ...c,
      display_name: displayName(c),
    }))
    const nextCursor = hasMore ? slice[slice.length - 1].last_name : null

    return jsonResponse({ items, next_cursor: nextCursor }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
