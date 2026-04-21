import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function POST(req: NextRequest, { params }: { params: Promise<{ invoice_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { invoice_id } = await params
  if (!/^[a-f0-9-]{36}$/i.test(invoice_id)) return NextResponse.json({ error: 'invalid invoice_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    // Ensure invoice is AUTHORISED (not DRAFT) before emailing
    const invoice = await client.getInvoice(invoice_id)
    if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (invoice.Status === 'DRAFT') {
      await client.authoriseInvoice(invoice_id)
    }
    await client.emailInvoice(invoice_id)
    return NextResponse.json({ ok: true, invoice_id, status: 'emailed' })
  } catch (e) {
    return NextResponse.json({ error: 'xero_email_invoice_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
