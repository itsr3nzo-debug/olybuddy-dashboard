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
 *   A) Quick shape — single-line variation:
 *      { title: string,
 *        amount?: number,        // OR `total` / `price` (aliases)
 *        total?: number,
 *        price?: number,
 *        description?: string,
 *        is_labour?: boolean,
 *        due_days?: number }
 *      → becomes a 1-line quote section with a single line item at that price.
 *
 *   B) Full shape — multi-section variation:
 *      { title, description?, due_days?, version_number?,
 *        sections: [{ name, description?,
 *                     line_items?: [{ item_name, item_price (aka price/amount),
 *                                     item_quantity?, is_labour?, … }] }] }
 *
 * Safety: this route only CREATES the quote version. The agent should
 * NEVER auto-accept a variation on behalf of the customer — acceptance
 * goes through POST /api/agent/fergus/quotes/{quote_id}/accept.
 */

const LineItem = z.object({
  item_name: z.string().max(200).optional(),
  itemName: z.string().max(200).optional(),
  // Price aliases — agents often produce `price` or `unit_price`
  item_price: z.number().min(0).max(1_000_000).optional(),
  itemPrice: z.number().min(0).max(1_000_000).optional(),
  unit_price: z.number().min(0).max(1_000_000).optional(),
  unitPrice: z.number().min(0).max(1_000_000).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  // Cost aliases
  item_cost: z.number().min(0).max(1_000_000).optional(),
  itemCost: z.number().min(0).max(1_000_000).optional(),
  unit_cost: z.number().min(0).max(1_000_000).optional(),
  // Quantity aliases
  item_quantity: z.number().min(0).max(100_000).optional(),
  itemQuantity: z.number().min(0).max(100_000).optional(),
  quantity: z.number().min(0).max(100_000).optional(),
  // Labour flag aliases
  is_labour: z.boolean().optional(),
  isLabour: z.boolean().optional(),
  // Pricebook ref
  price_book_line_item_id: z.number().int().positive().optional(),
  priceBookLineItemId: z.number().int().positive().optional(),
})

const Section = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  line_items: z.array(LineItem).max(100).optional(),
  lineItems: z.array(LineItem).max(100).optional(),
})

/**
 * Single permissive Body — covers both quick and full shapes. We
 * disambiguate in the handler by checking which fields were filled.
 * Earlier we used z.union([Quick, Full]) which produced a confusing
 * "invalid_union" error when the agent had a typo (`total` vs `amount`).
 */
const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  due_days: z.number().int().min(7).max(180).optional(),
  dueDays: z.number().int().min(7).max(180).optional(),
  version_number: z.number().int().positive().optional(),
  versionNumber: z.number().int().positive().optional(),
  // Quick-shape price aliases — pick whichever you've got.
  amount: z.number().min(0).max(1_000_000).optional(),
  total: z.number().min(0).max(1_000_000).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  is_labour: z.boolean().optional(),
  isLabour: z.boolean().optional(),
  // Full-shape sections (either casing)
  sections: z.array(Section).max(20).optional(),
})

function pickLineItem(li: z.infer<typeof LineItem>) {
  return {
    itemName: li.itemName ?? li.item_name,
    itemPrice: li.itemPrice ?? li.item_price ?? li.unitPrice ?? li.unit_price ?? li.price,
    itemCost: li.itemCost ?? li.item_cost ?? li.unit_cost,
    itemQuantity: li.itemQuantity ?? li.item_quantity ?? li.quantity,
    isLabour: li.isLabour ?? li.is_labour,
    priceBookLineItemId: li.priceBookLineItemId ?? li.price_book_line_item_id,
  }
}

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
    return NextResponse.json(
      {
        error: 'invalid body',
        issues: parsed.error.issues,
        hint: 'Quick: { title, amount } (or total/price). Full: { title, sections: [{ name, line_items: [...] }] }',
      },
      { status: 400 },
    )
  }
  const d = parsed.data
  const quickAmount = d.amount ?? d.total ?? d.price
  const hasQuick = quickAmount !== undefined
  const hasFull = Array.isArray(d.sections) && d.sections.length > 0
  if (!hasQuick && !hasFull) {
    return NextResponse.json(
      {
        error: 'either `amount` (quick shape) OR `sections` (full shape) is required',
        hint: 'Quick example: { "title": "Extra socket", "amount": 150 }. Full example: { "title": "Variation", "sections": [{ "name": "...", "line_items": [{ "item_name": "...", "item_price": 150 }] }] }',
      },
      { status: 400 },
    )
  }

  try {
    const client = await FergusClient.forClient(auth.clientId)

    let sections: Parameters<typeof client.createJobQuote>[1]['sections']
    if (hasQuick) {
      sections = [{
        name: d.title,
        description: d.description,
        lineItems: [{
          itemName: d.title,
          itemPrice: quickAmount,
          itemQuantity: 1,
          isLabour: d.isLabour ?? d.is_labour,
        }],
      }]
    } else {
      sections = d.sections!.map(s => ({
        name: s.name,
        description: s.description,
        lineItems: ((s.lineItems ?? s.line_items) ?? []).map(pickLineItem),
      }))
    }

    const quote = await client.createJobQuote(id, {
      title: d.title,
      description: d.description,
      dueDays: d.dueDays ?? d.due_days,
      versionNumber: d.versionNumber ?? d.version_number,
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
