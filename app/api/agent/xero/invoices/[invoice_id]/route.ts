import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

function assertGuid(id: string) {
  return /^[a-f0-9-]{36}$/i.test(id)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ invoice_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { invoice_id } = await params
  if (!assertGuid(invoice_id)) return NextResponse.json({ error: 'invalid invoice_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const invoice = await client.getInvoice(invoice_id)
    if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ invoice })
  } catch (e) {
    return NextResponse.json({ error: 'xero_get_invoice_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ invoice_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { invoice_id } = await params
  if (!assertGuid(invoice_id)) return NextResponse.json({ error: 'invalid invoice_id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const invoice = await client.updateInvoice(invoice_id, body)
    return NextResponse.json({ invoice })
  } catch (e) {
    return NextResponse.json({ error: 'xero_update_invoice_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
