import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const items = await client.listItems()
    return NextResponse.json({ count: items.length, items })
  } catch (e) {
    return NextResponse.json({ error: 'xero_list_items_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

const CreateBody = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  unit_price: z.number().nonnegative().optional(),
  account_code: z.string().max(20).optional(),
  tax_type: z.string().max(30).optional(),
  is_sold: z.boolean().optional(),
  is_purchased: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const item = await client.createItem({
      Code: d.code,
      Name: d.name,
      Description: d.description,
      UnitPrice: d.unit_price,
      AccountCode: d.account_code,
      TaxType: d.tax_type,
      IsSold: d.is_sold,
      IsPurchased: d.is_purchased,
    })
    return NextResponse.json({ item })
  } catch (e) {
    return NextResponse.json({ error: 'xero_create_item_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
