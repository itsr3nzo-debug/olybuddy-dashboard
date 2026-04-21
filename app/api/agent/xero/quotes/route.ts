import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'
import { z } from 'zod'

/** GET /api/agent/xero/quotes?status=DRAFT&contact_id=... — list quotes */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.toUpperCase()
  const contactId = url.searchParams.get('contact_id') || undefined
  const dateFrom = url.searchParams.get('date_from') || undefined
  if (status && !/^[A-Z]{1,20}$/.test(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  if (contactId && !/^[a-f0-9-]{36}$/i.test(contactId)) return NextResponse.json({ error: 'invalid contact_id' }, { status: 400 })
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return NextResponse.json({ error: 'invalid date_from' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const quotes = await client.listQuotes({ status, contactId, dateFrom })
    return NextResponse.json({ count: quotes.length, quotes })
  } catch (e) {
    return NextResponse.json({ error: 'xero_list_quotes_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

const CreateBody = z.object({
  contact_id: z.string().regex(/^[a-f0-9-]{36}$/i),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(500).optional(),
  status: z.enum(['DRAFT', 'SENT']).optional(),
  line_items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive(),
    unit_amount: z.number().nonnegative(),
    account_code: z.string().max(20).optional(),
    tax_type: z.string().max(30).optional(),
  })).min(1).max(100),
})

/** POST /api/agent/xero/quotes — create a quote. Default DRAFT so owner reviews. */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const quote = await client.createQuote({
      Contact: { ContactID: d.contact_id },
      Date: d.date,
      ExpiryDate: d.expiry_date,
      Title: d.title,
      Summary: d.summary,
      Status: d.status ?? 'DRAFT',
      LineItems: d.line_items.map(li => ({
        Description: li.description,
        Quantity: li.quantity,
        UnitAmount: li.unit_amount,
        AccountCode: li.account_code,
        TaxType: li.tax_type,
      })),
    })
    return NextResponse.json({ quote })
  } catch (e) {
    return NextResponse.json({ error: 'xero_create_quote_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
