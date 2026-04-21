import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'
import { z } from 'zod'

const Body = z.object({
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bank_account_id: z.string().regex(/^[a-f0-9-]{36}$/i),
  reference: z.string().max(200).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ bill_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { bill_id } = await params
  if (!/^[a-f0-9-]{36}$/i.test(bill_id)) return NextResponse.json({ error: 'invalid bill_id' }, { status: 400 })
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    await client.payBill({
      billId: bill_id,
      amount: parsed.data.amount,
      date: parsed.data.date,
      bankAccountId: parsed.data.bank_account_id,
      reference: parsed.data.reference,
    })
    return NextResponse.json({ ok: true, bill_id })
  } catch (e) {
    return NextResponse.json({ error: 'xero_pay_bill_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
