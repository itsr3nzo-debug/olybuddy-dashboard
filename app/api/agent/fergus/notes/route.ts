import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/notes
 *
 * Create a note on any Fergus entity. Maps to Fergus `POST /notes`.
 * Entities supported: job, customer, site, quote, job_phase, task,
 * enquiry, customer_invoice.
 *
 * Body: `{entity: 'job'|'customer'|..., entity_id: number, text: string, parent_id?: number, pin?: boolean}`
 */
const Body = z.object({
  entity: z.enum(['job', 'customer', 'site', 'quote', 'job_phase', 'task', 'enquiry', 'customer_invoice']),
  entity_id: z.number().int().positive(),
  text: z.string().min(1).max(8000),
  parent_id: z.number().int().positive().optional(),
  pin: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const note = await client.addNote({
      entityName: d.entity,
      entityId: d.entity_id,
      text: d.text,
      parentId: d.parent_id,
      isPinned: d.pin,
    })
    return NextResponse.json({ note })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_create_note_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
