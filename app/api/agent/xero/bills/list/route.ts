/**
 * GET /api/agent/xero/bills/list?from=2026-01-01&to=2026-04-17&summary=1
 *
 * Surfaces supplier bills (which are Dext's output once it syncs to Xero).
 * This is how we deliver "Dext-like" capability without a direct Dext integration:
 *   - Julian's Dext auto-syncs his receipts to Xero
 *   - We read from Xero's Bills endpoint
 *   - Nexley can answer "total spend on Screwfix last month?", "what's our March supplier spend?", etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to') ?? undefined
  const summary = url.searchParams.get('summary') === '1'

  if (!from) return NextResponse.json({ error: 'from (YYYY-MM-DD) required' }, { status: 400 })

  let xero: XeroClient
  try {
    xero = await XeroClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Xero not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  try {
    if (summary) {
      const suppliers = await xero.supplierSpendSummary({ dateFrom: from, dateTo: to })
      const total_gbp = suppliers.reduce((sum, s) => sum + s.total_gbp, 0)
      return NextResponse.json({ from, to: to ?? 'today', total_gbp, suppliers })
    } else {
      const bills = await xero.listBills({ dateFrom: from, dateTo: to })
      const slim = bills.map(b => ({
        invoice_id: b.InvoiceID,
        invoice_number: b.InvoiceNumber,
        supplier: (b.Contact as { Name?: string })?.Name ?? '?',
        date: b.Date,
        total_gbp: b.Total,
        amount_due_gbp: b.AmountDue,
        status: b.Status,
      }))
      return NextResponse.json({ from, to: to ?? 'today', count: slim.length, bills: slim })
    }
  } catch (e) {
    return NextResponse.json({ error: 'Xero fetch failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
