import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

/**
 * GET /api/agent/xero/reports?kind=aged_receivables|profit_loss|vat&from=YYYY-MM-DD&to=YYYY-MM-DD&contact_id=...
 *
 * Thin wrapper around Xero's Reports endpoints. Rich raw JSON — the agent
 * shapes it for owner summaries.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const contactId = url.searchParams.get('contact_id') || undefined

  if (!kind || !['aged_receivables', 'profit_loss', 'vat'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be one of: aged_receivables, profit_loss, vat' }, { status: 400 })
  }
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return NextResponse.json({ error: 'invalid from date' }, { status: 400 })
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: 'invalid to date' }, { status: 400 })
  if (contactId && !/^[a-f0-9-]{36}$/i.test(contactId)) return NextResponse.json({ error: 'invalid contact_id' }, { status: 400 })

  try {
    const client = await XeroClient.forClient(auth.clientId)
    let report: Record<string, unknown> | null = null
    if (kind === 'aged_receivables') report = await client.getAgedReceivables(contactId)
    else if (kind === 'profit_loss') report = await client.getProfitLoss({ fromDate: from, toDate: to })
    else if (kind === 'vat') report = await client.getVatReturn({ fromDate: from, toDate: to })
    if (!report) return NextResponse.json({ error: 'report_unavailable' }, { status: 404 })
    return NextResponse.json({ kind, report })
  } catch (e) {
    return NextResponse.json({ error: 'xero_report_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
