import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { z } from 'zod'

const Body = z.object({
  line_items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive().optional(),
    unit_price: z.number().nonnegative().optional(),
    unit_cost: z.number().nonnegative().optional(),
    item_type: z.enum(['labour', 'materials', 'other']).optional(),
  })).min(1).max(50),
})

/** POST /api/agent/fergus/jobs/<id>/line-items — add labour/materials lines to a job */
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const results = await client.addJobLineItems(id, parsed.data.line_items.map(it => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      unitCost: it.unit_cost,
      itemType: it.item_type,
    })))
    return NextResponse.json({ count: results.length, line_items: results })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_add_line_items_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
