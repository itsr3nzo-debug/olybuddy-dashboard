import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.toUpperCase()
  const dateFrom = url.searchParams.get('date_from') || undefined
  const contactId = url.searchParams.get('contact_id') || undefined
  if (status && !/^[A-Z]{1,20}$/.test(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return NextResponse.json({ error: 'invalid date_from (YYYY-MM-DD)' }, { status: 400 })
  if (contactId && !/^[a-f0-9-]{36}$/i.test(contactId)) return NextResponse.json({ error: 'invalid contact_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const invoices = await client.listInvoices({ status, dateFrom, contactId })
    return NextResponse.json({ count: invoices.length, invoices })
  } catch (e) {
    return NextResponse.json({ error: 'xero_list_invoices_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
