/**
 * POST /api/mobile/capture/[id]/commit
 *
 * Step 3 of the capture pipeline. The user has reviewed the suggested_action
 * on the confirm card and tapped the primary CTA. Commit the side effect
 * (log expense, add contact, draft estimate, etc) and link it back to the
 * capture row.
 *
 * Body: {
 *   action_type: 'log_expense' | 'add_contact' | 'draft_estimate' | …,
 *   params: { ... },                   // pre-filled from suggested_action.params
 *   edits?: { field: value, ... }       // user edits on the confirm card
 * }
 * Headers: Idempotency-Key
 *
 * Response: { ok, entity_id, entity_table, deep_link }
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { withIdempotency } from '@/lib/middleware/idempotency'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

interface CommitBody {
  action_type: string
  params?: Record<string, unknown>
  edits?: Record<string, unknown>
}

interface CommitResult {
  ok: boolean
  entity_id: string | null
  entity_table: string | null
  deep_link: string | null
}

export async function POST(
  request: Request,
  { params: routeParams }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id: captureId } = await routeParams

    const bodyText = await request.text()
    const body = (bodyText ? JSON.parse(bodyText) : {}) as CommitBody
    if (!body.action_type) {
      throw Errors.validation({ field: 'action_type' })
    }

    const sb = createUntypedServiceClient()

    // Load + verify capture ownership
    const { data: cap } = await sb
      .from('captures')
      .select('id, user_id, status, classification, suggested_action, photo_paths')
      .eq('id', captureId)
      .eq('user_id', claims.sub)
      .maybeSingle()
    if (!cap) throw Errors.notFound('Capture not found.')
    if (cap.status === 'committed') throw Errors.validation({ message: 'Already committed' })
    if (cap.status !== 'extracted') {
      throw Errors.validation({ message: `Cannot commit — capture is ${cap.status}` })
    }

    const merged: Record<string, unknown> = {
      ...((cap.suggested_action as { params?: Record<string, unknown> })?.params ?? {}),
      ...(body.params ?? {}),
      ...(body.edits ?? {}),
    }

    const { result } = await withIdempotency<CommitResult>(
      { request, endpoint: 'mobile.capture.commit', userId: claims.sub, bodyText },
      async () => {
        const dispatch = await dispatchAction(
          body.action_type,
          merged,
          { clientId, userId: claims.sub, captureId }
        )

        // Mark capture committed
        await sb
          .from('captures')
          .update({
            status: 'committed',
            committed_at: new Date().toISOString(),
            committed_action_type: body.action_type,
            committed_entity_id: dispatch.entity_id,
            committed_entity_table: dispatch.entity_table,
            updated_at: new Date().toISOString(),
          })
          .eq('id', captureId)

        return {
          status: 200,
          body: {
            ok: true,
            entity_id: dispatch.entity_id,
            entity_table: dispatch.entity_table,
            deep_link: dispatch.deep_link,
          },
        }
      }
    )

    return jsonResponse(result.body, { status: result.status, requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

interface DispatchContext {
  clientId: string
  userId: string
  captureId: string
}

interface DispatchResult {
  entity_id: string | null
  entity_table: string | null
  deep_link: string | null
}

async function dispatchAction(
  actionType: string,
  params: Record<string, unknown>,
  ctx: DispatchContext
): Promise<DispatchResult> {
  const sb = createUntypedServiceClient()

  switch (actionType) {
    case 'add_contact': {
      // DA fix C11: accept first_name/last_name directly when AI provides them,
      // and handle "Last, First" format (common on UK trade business cards).
      let firstName: string | null = null
      let lastName: string | null = null
      if (typeof params.first_name === 'string' && params.first_name.trim()) {
        firstName = (params.first_name as string).trim()
      }
      if (typeof params.last_name === 'string' && params.last_name.trim()) {
        lastName = (params.last_name as string).trim()
      }
      if (!firstName && !lastName && typeof params.name === 'string') {
        const name = (params.name as string).trim()
        if (name.includes(',')) {
          // "Last, First" format
          const [last, ...firstParts] = name.split(',').map((s) => s.trim())
          lastName = last || null
          firstName = firstParts.join(' ').trim() || null
        } else {
          const [first, ...rest] = name.split(/\s+/)
          firstName = first || null
          lastName = rest.length > 0 ? rest.join(' ') : null
        }
      }
      const ins = await sb
        .from('contacts')
        .insert({
          client_id: ctx.clientId,
          first_name: firstName,
          last_name: lastName,
          phone: params.phone ?? null,
          email: params.email ?? null,
          company: params.company ?? null,
          source: 'capture',
          custom_fields: {
            capture_id: ctx.captureId,
            ...(params.role ? { role: params.role } : {}),
            ...(params.address ? { address: params.address } : {}),
          },
        })
        .select('id')
        .single()
      if (ins.error) throw Errors.internal(ins.error.message)
      return {
        entity_id: ins.data.id as string,
        entity_table: 'contacts',
        deep_link: `/contact/${ins.data.id}`,
      }
    }

    case 'log_expense':
    case 'log_materials': {
      // DA fix C9 + C13: use proper category, validate total_pence is a real
      // integer (Vision sometimes hallucinates floats), refetch on collision.
      const rawTotal = params.total_pence
      const totalPence =
        typeof rawTotal === 'number' && Number.isFinite(rawTotal)
          ? Math.round(rawTotal)
          : 0
      const supplier = (params.supplier as string) ?? 'unknown'
      const dedupeKey = `capture:${ctx.captureId}`
      const ins = await sb
        .from('agent_actions')
        .insert({
          client_id: ctx.clientId,
          occurred_at: (params.date as string) ?? new Date().toISOString(),
          category: actionType === 'log_materials' ? 'materials_logged' : 'expense_logged',
          summary: `${actionType === 'log_materials' ? 'Materials' : 'Expense'} from ${supplier}: £${(totalPence / 100).toFixed(2)}`,
          value_gbp: totalPence / 100,
          meta: { source: 'capture', capture_id: ctx.captureId, ...params },
          dedupe_key: dedupeKey,
        })
        .select('id')
        .maybeSingle()
      if (ins.error) {
        if ((ins.error as { code?: string }).code !== '23505') {
          throw Errors.internal(ins.error.message)
        }
        // Unique-violation — fetch the prior row so we don't lose entity_id
        const existing = await sb
          .from('agent_actions')
          .select('id')
          .eq('dedupe_key', dedupeKey)
          .maybeSingle()
        return {
          entity_id: existing.data?.id ?? null,
          entity_table: 'agent_actions',
          deep_link: '/dashboard',
        }
      }
      return {
        entity_id: ins.data?.id ?? null,
        entity_table: 'agent_actions',
        deep_link: '/dashboard',
      }
    }

    case 'draft_estimate': {
      const totalPence = (params.total_pence as number) ?? 0
      const lineItems = (params.line_items as unknown[]) ?? []
      const customerName = String(params.customer_name ?? 'Capture customer')
      const ins = await sb
        .from('estimates')
        .insert({
          client_id: ctx.clientId,
          title: `Estimate for ${customerName}`,
          total_pence: totalPence,
          line_items: lineItems,
          notes: (params.notes as string) ?? null,
          status: 'pending_owner_review',
          created_by_ai: true,
          dedupe_key: `capture:${ctx.captureId}`,
          // takeoff_json + pricing_json are NOT NULL in the existing schema
          takeoff_json: { source: 'capture', capture_id: ctx.captureId },
          pricing_json: { line_items: lineItems, total_pence: totalPence },
          meta: { source: 'capture', capture_id: ctx.captureId },
        })
        .select('id')
        .single()
      if (ins.error) throw Errors.internal(ins.error.message)
      return {
        entity_id: ins.data.id as string,
        entity_table: 'estimates',
        deep_link: `/estimate/${ins.data.id}`,
      }
    }

    case 'create_booking': {
      const dedupeKey = `capture:${ctx.captureId}`
      const ins = await sb
        .from('agent_actions')
        .insert({
          client_id: ctx.clientId,
          occurred_at: new Date().toISOString(),
          category: 'booking_made',
          summary: `Booking captured: ${params.customer_name ?? 'unknown'} on ${params.date ?? 'unknown'}`,
          meta: { source: 'capture', capture_id: ctx.captureId, ...params },
          dedupe_key: dedupeKey,
        })
        .select('id')
        .maybeSingle()
      if (ins.error) {
        if ((ins.error as { code?: string }).code !== '23505') {
          throw Errors.internal(ins.error.message)
        }
        const existing = await sb.from('agent_actions').select('id').eq('dedupe_key', dedupeKey).maybeSingle()
        return { entity_id: existing.data?.id ?? null, entity_table: 'agent_actions', deep_link: '/dashboard' }
      }
      return {
        entity_id: ins.data?.id ?? null,
        entity_table: 'agent_actions',
        deep_link: '/dashboard',
      }
    }

    case 'reply_to_customer':
    case 'flag_for_owner': {
      // These open a chat with the AI Employee about the capture
      const ins = await sb
        .from('agent_chat_sessions')
        .insert({
          client_id: ctx.clientId,
          user_id: ctx.userId,
          title: actionType === 'reply_to_customer' ? 'Drafting customer reply' : 'Capture review',
        })
        .select('id')
        .single()
      if (ins.error) throw Errors.internal(ins.error.message)
      // Add a starter message linking the capture
      await sb.from('agent_chat_messages').insert({
        session_id: ins.data.id,
        client_id: ctx.clientId,
        role: 'user',
        content:
          actionType === 'reply_to_customer'
            ? `I just snapped a customer message — ${JSON.stringify(params).slice(0, 500)}. Help me draft a reply.`
            : `I just snapped this — ${JSON.stringify(params).slice(0, 500)}. What should I do?`,
        status: 'done',
        metadata: { capture_id: ctx.captureId },
      })
      return {
        entity_id: ins.data.id as string,
        entity_table: 'agent_chat_sessions',
        deep_link: `/chat?session=${ins.data.id}`,
      }
    }

    case 'no_action':
      return { entity_id: null, entity_table: null, deep_link: null }

    default:
      throw Errors.validation({ field: 'action_type', message: `unknown action: ${actionType}` })
  }
}
