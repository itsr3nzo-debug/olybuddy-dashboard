/**
 * GET /api/mobile/inbox/[id]
 *
 * Single customer conversation: thread + customer + AI state.
 * Mobile loads this when the user taps a conversation row.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const sb = service()
    const [conv, messages] = await Promise.all([
      sb.from('conversation_sessions').select('*').eq('id', id).eq('client_id', clientId).maybeSingle(),
      sb
        .from('comms_log')
        .select('id, direction, body, channel, created_at, metadata')
        .eq('conversation_id', id)
        .eq('client_id', clientId)
        .order('created_at', { ascending: true })
        .limit(500),
    ])

    if (!conv.data) throw Errors.notFound('Conversation not found.')

    return jsonResponse(
      {
        conversation: conv.data,
        messages: messages.data ?? [],
        ai_state: {
          paused: !!conv.data.ai_paused,
          paused_at: conv.data.ai_paused_at,
          taken_over_by: conv.data.taken_over_by,
        },
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
