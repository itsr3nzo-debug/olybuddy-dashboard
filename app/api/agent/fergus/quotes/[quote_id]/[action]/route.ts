import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/quotes/<quote_id>/<action>
 * action ∈ {publish, mark-sent, accept, decline, void}
 *
 * Lifecycle wrappers over Fergus `POST /jobs/quotes/{id}/<action>` endpoints.
 *
 * Body (all optional unless noted):
 *   publish    — {published_by?: string}
 *   mark-sent  — {is_sent?: boolean} (default true)
 *   accept     — {accepted_by: string (REQUIRED), selected_section_ids?: number[]}
 *   decline    — {rejected_by?: string, reason_notes?: string}
 *   void       — {}
 *
 * Safety: the agent should NEVER call `accept` without explicit owner approval
 * — that's a contractual act on behalf of the customer.
 */

const ActionSchema = z.enum(['publish', 'mark-sent', 'accept', 'decline', 'void'])

const Publish = z.object({ published_by: z.string().max(200).optional() })
const MarkSent = z.object({ is_sent: z.boolean().optional() })
const Accept = z.object({
  accepted_by: z.string().min(1).max(200),
  selected_section_ids: z.array(z.number().int().positive()).max(50).optional(),
})
const Decline = z.object({
  rejected_by: z.string().max(200).optional(),
  reason_notes: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ quote_id: string; action: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { quote_id, action } = await params
  const id = parseInt(quote_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid quote_id' }, { status: 400 })
  const actionParse = ActionSchema.safeParse(action)
  if (!actionParse.success) {
    return NextResponse.json({ error: 'invalid action', allowed: ActionSchema.options }, { status: 400 })
  }
  const raw = await req.json().catch(() => ({}))
  try {
    const client = await FergusClient.forClient(auth.clientId)
    let result: Record<string, unknown> | null
    switch (actionParse.data) {
      case 'publish': {
        const p = Publish.safeParse(raw)
        if (!p.success) return NextResponse.json({ error: 'invalid body', issues: p.error.issues }, { status: 400 })
        result = await client.publishQuote(id, p.data.published_by)
        break
      }
      case 'mark-sent': {
        const p = MarkSent.safeParse(raw)
        if (!p.success) return NextResponse.json({ error: 'invalid body', issues: p.error.issues }, { status: 400 })
        result = await client.markQuoteSent(id, p.data.is_sent ?? true)
        break
      }
      case 'accept': {
        const p = Accept.safeParse(raw)
        if (!p.success) return NextResponse.json({ error: 'invalid body', issues: p.error.issues, hint: 'accepted_by is required — pass the customer name' }, { status: 400 })
        result = await client.acceptQuote(id, p.data.accepted_by, p.data.selected_section_ids)
        break
      }
      case 'decline': {
        const p = Decline.safeParse(raw)
        if (!p.success) return NextResponse.json({ error: 'invalid body', issues: p.error.issues }, { status: 400 })
        result = await client.declineQuote(id, p.data.rejected_by, p.data.reason_notes)
        break
      }
      case 'void': {
        result = await client.voidQuote(id)
        break
      }
    }
    return NextResponse.json({ quote: result, action: actionParse.data })
  } catch (e) {
    return NextResponse.json({ error: `fergus_quote_${actionParse.data}_failed`, detail: safeErrorDetail(e) }, { status: 502 })
  }
}
