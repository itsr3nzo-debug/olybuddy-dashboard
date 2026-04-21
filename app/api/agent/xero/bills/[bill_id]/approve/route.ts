import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function POST(req: NextRequest, { params }: { params: Promise<{ bill_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { bill_id } = await params
  if (!/^[a-f0-9-]{36}$/i.test(bill_id)) return NextResponse.json({ error: 'invalid bill_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const bill = await client.approveBill(bill_id)
    return NextResponse.json({ bill })
  } catch (e) {
    return NextResponse.json({ error: 'xero_approve_bill_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
