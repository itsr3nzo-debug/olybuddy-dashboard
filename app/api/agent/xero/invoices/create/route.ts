/**
 * POST /api/agent/xero/invoices/create
 *
 * VPS agent calls this to draft an invoice in Julian's Xero. Dashboard holds the
 * Xero tokens so the agent doesn't need them; we proxy the call.
 *
 * Body:
 * {
 *   contact: { ContactID?: string, Name?: string, Phone?: string, Email?: string, IsSubcontractor?: boolean },
 *   lines: [ { Description, Quantity, UnitAmount, AccountCode? } ],
 *   date?: "YYYY-MM-DD",
 *   dueDate?: "YYYY-MM-DD",
 *   reference?: string,
 *   // UK tax helpers
 *   reverseChargeEligible?: boolean,   // if true, applies ECOUTPUTSERVICES (DRC 20%)
 *   autoApplyVat?: boolean,            // default true
 *   // Status — we always default to DRAFT for safety. Trust-routing gate can AUTHORISE later.
 *   status?: 'DRAFT' | 'AUTHORISED',
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, logAgentAction } from '@/lib/agent-auth'
import { enforceTrust, safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient, XeroLineItem } from '@/lib/integrations/xero'

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { clientId } = auth

  const body = await req.json().catch(() => ({}))
  const { contact, lines, date, dueDate, reference, reverseChargeEligible, autoApplyVat = true, status = 'DRAFT' } = body

  if (!contact || (!contact.ContactID && !contact.Name)) {
    return NextResponse.json({ error: 'contact requires ContactID or Name' }, { status: 400 })
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'lines must be a non-empty array' }, { status: 400 })
  }

  // TRUST GATE (server-side — do not trust the VPS agent).
  // Calculate total from lines to know which threshold class this is.
  const totalGbp = lines.reduce((sum: number, l: { UnitAmount?: number; Quantity?: number }) =>
    sum + (Number(l.UnitAmount ?? 0) * Number(l.Quantity ?? 1)), 0)
  const actionClass = status === 'AUTHORISED'
    ? (totalGbp > 100 ? 'send_big_external' : 'send_small_external')
    : 'draft_write'
  const trust = enforceTrust(auth, actionClass, totalGbp)
  if (!trust.allowed) return trust.response!

  let xero: XeroClient
  try {
    xero = await XeroClient.forClient(clientId)
  } catch (e) {
    return NextResponse.json(
      { error: 'Xero not connected for this client', detail: safeErrorDetail(e) },
      { status: 409 },
    )
  }

  // Resolve or create contact
  let contactRef: { ContactID: string }
  try {
    if (contact.ContactID) {
      contactRef = { ContactID: contact.ContactID }
    } else {
      // Try to find by name first
      const existing = await xero.listContacts(contact.Name)
      const match = existing.find(c => c.Name.toLowerCase() === contact.Name.toLowerCase())
      if (match) {
        contactRef = { ContactID: match.ContactID }
      } else {
        const created = await xero.createContact({
          Name: contact.Name,
          EmailAddress: contact.Email,
          Phone: contact.Phone,
          IsSubcontractor: contact.IsSubcontractor,
        })
        contactRef = { ContactID: created.ContactID }
      }
    }
  } catch (e) {
    return NextResponse.json({ error: 'Contact lookup/create failed', detail: safeErrorDetail(e) }, { status: 502 })
  }

  // Apply UK tax codes
  let finalLines: XeroLineItem[] = lines as XeroLineItem[]
  if (autoApplyVat) {
    const contactInfo = contact.ContactID
      ? (await xero.getContact(contact.ContactID).catch(() => null))
      : { IsSubcontractor: contact.IsSubcontractor ?? false }
    finalLines = XeroClient.applyUkTaxCodes(
      finalLines,
      contactInfo ?? { IsSubcontractor: false },
      !!reverseChargeEligible,
    )
  }

  const today = new Date().toISOString().split('T')[0]
  const defaultDue = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d.toISOString().split('T')[0]
  })()

  let invoice
  try {
    invoice = await xero.createInvoice({
      Type: 'ACCREC',
      Contact: contactRef,
      Date: date ?? today,
      DueDate: dueDate ?? defaultDue,
      LineItems: finalLines,
      Reference: reference,
      Status: status,
      LineAmountTypes: 'Exclusive',
    })
  } catch (e) {
    return NextResponse.json({ error: 'Xero createInvoice failed', detail: safeErrorDetail(e) }, { status: 502 })
  }

  // Audit
  await logAgentAction({
    clientId,
    category: 'quote_sent',
    skillUsed: 'draft-xero-invoice',
    summary: `Xero invoice ${invoice.InvoiceNumber} drafted — ${contact.Name ?? invoice.InvoiceID} — £${invoice.Total ?? 0}`,
    outcomeTag: 'n_a',
    valueGbp: invoice.Total,
    contactName: contact.Name,
    contactPhone: contact.Phone,
    meta: { invoiceId: invoice.InvoiceID, status: invoice.Status, reverseCharge: !!reverseChargeEligible },
  })

  return NextResponse.json({
    invoice_id: invoice.InvoiceID,
    invoice_number: invoice.InvoiceNumber,
    status: invoice.Status,
    total_gbp: invoice.Total,
    amount_due: invoice.AmountDue,
    due_date: invoice.DueDate,
  })
}
