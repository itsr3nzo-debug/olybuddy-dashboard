/**
 * GET /api/agent/xero/invoices/overdue
 *
 * Returns Julian's overdue customer invoices so Nexley can draft chase messages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  let xero: XeroClient
  try {
    xero = await XeroClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Xero not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  try {
    const invoices = await xero.listOverdueInvoices()
    const now = Date.now()
    const summary = invoices.map(i => ({
      invoice_id: i.InvoiceID,
      invoice_number: i.InvoiceNumber,
      contact: (i.Contact as { ContactID: string; Name?: string }).Name ?? 'Unknown',
      contact_id: (i.Contact as { ContactID: string }).ContactID,
      total_gbp: i.Total,
      amount_due_gbp: i.AmountDue,
      days_overdue: Math.floor((now - new Date(i.DueDate).getTime()) / (1000 * 60 * 60 * 24)),
      due_date: i.DueDate,
    }))
    return NextResponse.json({ count: summary.length, invoices: summary })
  } catch (e) {
    return NextResponse.json({ error: 'Xero fetch failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
