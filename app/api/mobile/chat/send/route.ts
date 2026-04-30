/**
 * POST /api/mobile/chat/send
 *
 * Mobile-side chat send. Inserts the user message + assistant placeholder
 * via the create_chat_pair RPC (single statement, atomic — DA fix B9 for
 * orphan-row prevention). Returns immediately; the mobile app then opens
 * an SSE connection to /api/chat/stream/[conversation_id] for the reply.
 *
 * Body: {
 *   conversation_id?: string         // omit to start a new conversation
 *   content: string
 *   attachments?: Attachment[]
 * }
 * Headers: Idempotency-Key: <uuid>   (recommended — DA-fixed claim-then-act)
 *
 * Response: { conversation_id, user_message_id, assistant_message_id }
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { withIdempotency } from '@/lib/middleware/idempotency'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const MAX_CONTENT_CHARS = 100_000
const MAX_ATTACHMENTS = 20

let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

interface SendBody {
  conversation_id?: string
  content?: string
  attachments?: Array<{ url: string; name: string; mime: string; size: number; kind: string }>
}

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('chat_send', claims.sub)

    const clientId = getClientIdFromClaims(claims)
    const sb = service()

    // Verify AI consent — gates all chat
    const { data: client } = await sb
      .from('clients')
      .select('ai_consent_at')
      .eq('id', clientId)
      .maybeSingle()
    if (!client?.ai_consent_at) throw Errors.consentRequired()

    // DA B7 fix — read body once, hash here, parse here, pass parsed in
    const bodyText = await request.text()
    let body: SendBody
    try {
      body = bodyText ? (JSON.parse(bodyText) as SendBody) : {}
    } catch {
      throw Errors.validation({ message: 'Invalid JSON body' })
    }

    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content && (!body.attachments || body.attachments.length === 0)) {
      throw Errors.validation({ message: 'content or attachments required' })
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw Errors.validation({ field: 'content', max_chars: MAX_CONTENT_CHARS })
    }
    if (body.attachments && body.attachments.length > MAX_ATTACHMENTS) {
      throw Errors.validation({ field: 'attachments', max: MAX_ATTACHMENTS })
    }

    const idempotencyKey = request.headers.get('idempotency-key') ?? null

    const { result } = await withIdempotency(
      { request, endpoint: 'mobile.chat.send', userId: claims.sub, bodyText },
      async () => {
        // Atomic insert via RPC (DA B9 fix). Returns
        // { conversation_id, user_message_id, assistant_message_id }
        const rpc = await sb.rpc('create_chat_pair', {
          p_session_id: body.conversation_id ?? null,
          p_client_id: clientId,
          p_user_id: claims.sub,
          p_content: content,
          p_attachments: body.attachments ?? null,
          p_idempotency_key: idempotencyKey,
        })
        if (rpc.error) {
          if (rpc.error.code === 'P0002') {
            throw Errors.notFound('Conversation not found.')
          }
          throw Errors.internal(rpc.error.message)
        }
        const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
        const r = row as
          | { conversation_id: string; user_message_id: string; assistant_message_id: string }
          | null
        if (!r) throw Errors.internal('create_chat_pair returned empty')
        return {
          status: 200,
          body: {
            conversation_id: r.conversation_id,
            user_message_id: r.user_message_id,
            assistant_message_id: r.assistant_message_id,
          },
        }
      }
    )

    return jsonResponse(result.body, { status: result.status, requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
