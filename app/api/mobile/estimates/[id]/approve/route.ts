/**
 * POST /api/mobile/estimates/[id]/approve
 *
 * Owner approves an AI-drafted estimate. Optionally `send_to_customer: true`
 * triggers an outbound message via the channel of the customer's last
 * conversation (WhatsApp/SMS), formatted as a plain-text quote.
 *
 * Body: { send_to_customer: boolean }
 * Headers: Idempotency-Key recommended
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { withIdempotency } from '@/lib/middleware/idempotency'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id } = await params

    const bodyText = await request.text()
    const body = (bodyText ? JSON.parse(bodyText) : {}) as { send_to_customer?: boolean }

    interface ApproveResult {
      ok: boolean
      status: string
      already: boolean
      total_pence: number | null
      sent_to_conversation_id: string | null
    }
    const { result } = await withIdempotency<ApproveResult>(
      { request, endpoint: 'mobile.estimates.approve', userId: claims.sub, bodyText },
      async () => {
        const sb = createUntypedServiceClient()

        const { data: est, error: readErr } = await sb
          .from('estimates')
          .select('id, contact_id, total_pence, line_items, status')
          .eq('id', id)
          .eq('client_id', clientId)
          .maybeSingle()
        if (readErr) throw Errors.internal(readErr.message)
        if (!est) throw Errors.notFound('Estimate not found.')
        if (est.status === 'approved') {
          // Idempotent — already approved, return current state
          return {
            status: 200,
            body: {
              ok: true,
              status: 'approved',
              already: true,
              total_pence: est.total_pence ?? null,
              sent_to_conversation_id: null,
            },
          }
        }

        const { data: updated, error: upErr } = await sb
          .from('estimates')
          .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            approved_by: claims.sub,
          })
          .eq('id', id)
          .eq('client_id', clientId)
          .select('id, status, total_pence')
          .single()
        if (upErr) throw Errors.internal(upErr.message)

        let sentTo: string | null = null
        if (body.send_to_customer && est.contact_id) {
          const { data: conv } = await sb
            .from('conversation_sessions')
            .select('id, channel')
            .eq('client_id', clientId)
            .eq('contact_id', est.contact_id)
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (conv) {
            const formatted = formatEstimateText(est)
            await sb.from('comms_log').insert({
              client_id: clientId,
              conversation_id: conv.id,
              direction: 'outbound',
              body: formatted,
              channel: conv.channel ?? 'whatsapp',
              metadata: { source: 'estimate_approve', estimate_id: id, sent_by: claims.sub },
            })
            sentTo = conv.id as string
          }
        }

        return {
          status: 200,
          body: {
            ok: true,
            status: updated.status as string,
            already: false,
            total_pence: (updated.total_pence as number | null) ?? null,
            sent_to_conversation_id: sentTo,
          },
        }
      }
    )

    return jsonResponse(result.body, { status: result.status, requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

interface EstimateRow {
  total_pence: number | null
  line_items: Array<{ description: string; quantity: number; unit_price_pence: number }> | null
}

function formatEstimateText(est: EstimateRow): string {
  const lines = (est.line_items ?? []).map(
    (l) =>
      `• ${l.description} (${l.quantity} × £${(l.unit_price_pence / 100).toFixed(2)}) = £${(
        (l.quantity * l.unit_price_pence) /
        100
      ).toFixed(2)}`
  )
  const total = est.total_pence ? `£${(est.total_pence / 100).toFixed(2)}` : '—'
  return [
    'Hi — your estimate:',
    ...lines,
    '',
    `Total: ${total}`,
    '',
    'Let me know if you\'d like to go ahead.',
  ].join('\n')
}
