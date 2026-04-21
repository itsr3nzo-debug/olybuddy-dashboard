import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/variations
 *
 * Fergus has NO variation endpoint — variations are modelled as a new
 * quote (or new version of an existing quote). This route accepts an
 * owner-friendly shape and translates it into `POST /jobs/{id}/quotes`.
 *
 * Two shapes accepted:
 *
 *   A) Quick shape — agent-friendly:
 *      { title, amount, description?, is_labour? }
 *      → becomes a 1-line quote section with a single line item at that price.
 *
 *   B) Full shape — passes through to Fergus:
 *      { title, due_days?, description?, version_number?, sections: [...] }
 *      where sections match the Fergus shape:
 *      [{ name, description?, line_items?: [{ item_name, item_price, item_quantity?, is_labour?, price_book_line_item_id? }] }]
 *
 * Safety: the agent should NEVER auto-accept a variation on behalf of the
 * customer — this route only CREATES the quote version. Acceptance goes
 * through POST /api/agent/fergus/quotes/{quote_id}/accept with the
 * customer's name.
 */

const QuickBody = z.object({
  title: z.string().min(1).max(200),
  amount: z.number().min(0).max(1_000_000),
  description: z.string().max(2000).optional(),
  is_labour: z.boolean().optional(),
  due_days: z.number().int().min(7).max(180).optional(),
  version_number: z.number().int().positive().optional(),
})

const LineItem = z.object({
  item_name: z.string().max(200).optional(),
  item_price: z.number().min(0).max(1_000_000).optional(),
  item_cost: z.number().min(0).max(1_000_000).optional(),
  item_quantity: z.number().min(0).max(100_000).optional(),
  is_labour: z.boolean().optional(),
  price_book_line_item_id: z.number().int().positive().optional(),
})

const Section = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  line_items: z.array(LineItem).max(100).optional(),
})

const FullBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  due_days: z.number().int().min(7).max(180).optional(),
  version_number: z.number().int().positive().optional(),
  sections: z.array(Section).min(1).max(20),
})

const Body = z.union([QuickBody, FullBody])

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)

    let sections: Parameters<typeof client.createJobQuote>[1]['sections']
    if ('amount' in d) {
      // Quick shape
      sections = [{
        name: d.title,
        description: d.description,
        lineItems: [{
          itemName: d.title,
          itemPrice: d.amount,
          itemQuantity: 1,
          isLabour: d.is_labour,
        }],
      }]
    } else {
      // Full shape — map snake_case → camelCase
      sections = d.sections.map(s => ({
        name: s.name,
        description: s.description,
        lineItems: (s.line_items ?? []).map(li => ({
          itemName: li.item_name,
          itemPrice: li.item_price,
          itemCost: li.item_cost,
          itemQuantity: li.item_quantity,
          isLabour: li.is_labour,
          priceBookLineItemId: li.price_book_line_item_id,
        })),
      }))
    }

    const quote = await client.createJobQuote(id, {
      title: d.title,
      description: d.description,
      dueDays: d.due_days,
      versionNumber: d.version_number,
      sections,
    })
    return NextResponse.json({
      variation_quote: quote,
      note: 'Variation created as a new quote on the job. Publish + send via POST /api/agent/fergus/quotes/{quote_id}/publish then /mark-sent. Customer acceptance via /accept.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_job_variation_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
