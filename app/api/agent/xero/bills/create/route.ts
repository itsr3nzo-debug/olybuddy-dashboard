import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'
import { z } from 'zod'

const Body = z.object({
  contact_id: z.string().regex(/^[a-f0-9-]{36}$/i),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().max(100).optional(),
  status: z.enum(['DRAFT', 'AUTHORISED']).optional(),
  line_items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive(),
    unit_amount: z.number().nonnegative(),
    account_code: z.string().max(20).optional(),
    tax_type: z.string().max(30).optional(),
  })).min(1).max(100),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const bill = await client.createBill({
      Type: 'ACCPAY',
      Contact: { ContactID: d.contact_id },
      Date: d.date,
      DueDate: d.due_date,
      Reference: d.reference,
      Status: d.status ?? 'DRAFT',
      LineItems: d.line_items.map(li => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unit_amount,
        AccountCode: li.account_code,
        TaxType: li.tax_type,
      })),
    })
    return NextResponse.json({ bill })
  } catch (e) {
    return NextResponse.json({ error: 'xero_create_bill_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
