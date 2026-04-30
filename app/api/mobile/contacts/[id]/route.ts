/**
 * GET    /api/mobile/contacts/[id]   — contact detail + recent activity timeline
 * PATCH  /api/mobile/contacts/[id]   — update name/email/notes (phone immutable — keyed against WhatsApp/SMS)
 * DELETE /api/mobile/contacts/[id]   — remove contact (cascade unlinks comms_log via FK)
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


function svc() {
  return createUntypedServiceClient()
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('reads', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const sb = svc()
    const [contact, recentComms, conversations, estimates] = await Promise.all([
      sb.from('contacts').select('*').eq('id', id).eq('client_id', clientId).maybeSingle(),
      sb
        .from('comms_log')
        .select('id, direction, body, channel, created_at')
        .eq('client_id', clientId)
        .eq('contact_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      sb
        .from('conversation_sessions')
        .select('id, channel, last_message_at, status')
        .eq('client_id', clientId)
        .eq('contact_id', id)
        .order('last_message_at', { ascending: false }),
      sb
        .from('estimates')
        .select('id, total_pence, status, created_at')
        .eq('client_id', clientId)
        .eq('contact_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (!contact.data) throw Errors.notFound('Contact not found.')

    return jsonResponse(
      {
        contact: contact.data,
        recent_messages: recentComms.data ?? [],
        conversations: conversations.data ?? [],
        estimates: estimates.data ?? [],
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    // Schema (verified): contacts has first_name, last_name, email, custom_fields
    // (no `name`/`notes`). We accept name (split on space) for convenience and
    // route notes into custom_fields jsonb.
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string
          first_name?: string
          last_name?: string
          email?: string
          notes?: string
        }
      | null
    if (!body || Object.keys(body).length === 0) {
      throw Errors.validation({ body: 'At least one field required' })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.first_name !== undefined) updates.first_name = body.first_name
    if (body.last_name !== undefined) updates.last_name = body.last_name
    if (body.name !== undefined) {
      const [first, ...rest] = body.name.trim().split(/\s+/)
      updates.first_name = first ?? null
      updates.last_name = rest.length > 0 ? rest.join(' ') : null
    }
    if (body.email !== undefined) updates.email = body.email
    if (body.notes !== undefined) {
      const cur = await svc()
        .from('contacts')
        .select('custom_fields')
        .eq('id', id)
        .eq('client_id', clientId)
        .maybeSingle()
      if (!cur.data) throw Errors.notFound('Contact not found.')
      const cf = (cur.data.custom_fields as Record<string, unknown> | null) ?? {}
      cf.notes = body.notes
      updates.custom_fields = cf
    }

    const { data, error } = await svc()
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .eq('client_id', clientId)
      .select('*')
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!data) throw Errors.notFound('Contact not found.')
    return jsonResponse(data, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const { error } = await svc()
      .from('contacts')
      .delete()
      .eq('id', id)
      .eq('client_id', clientId)
    if (error) throw Errors.internal(error.message)
    return jsonResponse({ ok: true }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
