import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { XeroClient, type XeroLineItem } from '@/lib/integrations/xero'

/**
 * POST /api/agent/fergus/quotes/<quote_id>/invoice-via-xero
 *
 * Workaround F — variation-quote → Xero invoice chain.
 *
 * Once a Fergus quote (original or variation) is accepted, this route
 * reads its sections + line items and creates the corresponding invoice
 * in Xero. Use case: customer signs off on a £250 variation → agent
 * creates the variation quote via /jobs/{id}/variations → customer
 * accepts via /quotes/{id}/accept → agent calls this to invoice in
 * Xero without owner needing to touch either Fergus or Xero UI.
 *
 * Same caveat as /jobs/{id}/invoice-via-xero: the invoice lives in Xero
 * only. Fergus-side job P&L won't reflect it.
 *
 * Body mirrors the job-level version: {due_days, status, reference,
 * send_email, line_amount_types, tax_type}.
 */

const Body = z.object({
  due_days: z.number().int().min(1).max(180).optional(),
  status: z.enum(['DRAFT', 'AUTHORISED']).optional(),
  reference: z.string().max(200).optional(),
  send_email: z.boolean().optional(),
  line_amount_types: z.enum(['Exclusive', 'Inclusive', 'NoTax']).optional(),
  tax_type: z.string().max(50).optional(),
})

type QuoteLineItem = {
  itemName?: string
  itemDescription?: string
  itemQuantity?: number
  itemPrice?: number
  isLabour?: boolean
  isCombined?: boolean
  combinedItemName?: string
}

type QuoteSection = {
  name?: string
  lineItems?: QuoteLineItem[]
  sections?: QuoteSection[]
}

type QuoteData = {
  id?: number
  title?: string
  status?: string
  isAccepted?: boolean
  acceptedAt?: string
  jobId?: number
  sections?: QuoteSection[]
  [k: string]: unknown
}

type FergusContactItem = { contactType?: string; contactValue?: string }

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

function flattenLineItems(sections: QuoteSection[] | undefined): Array<{ section: string | undefined; line: QuoteLineItem }> {
  const out: Array<{ section: string | undefined; line: QuoteLineItem }> = []
  const walk = (s: QuoteSection, parentName?: string) => {
    const label = [parentName, s.name].filter(Boolean).join(' / ') || undefined
    for (const li of s.lineItems ?? []) out.push({ section: label, line: li })
    for (const sub of s.sections ?? []) walk(sub, label)
  }
  for (const top of sections ?? []) walk(top)
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ quote_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { quote_id } = await params
  const quoteId = parseInt(quote_id, 10)
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return NextResponse.json({ error: 'invalid quote_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data

  try {
    const fergus = await FergusClient.forClient(auth.clientId)
    const xero = await XeroClient.forClient(auth.clientId)

    const quoteRaw = await fergus.getQuote(quoteId)
    if (!quoteRaw) return NextResponse.json({ error: 'quote_not_found', quote_id: quoteId }, { status: 404 })
    const quote = quoteRaw as QuoteData

    // Guard: ideally only invoice once the customer has accepted. Warn but
    // don't block (sometimes Fergus marks accept async via a different signal).
    const acceptedLikeStatus = ['Accepted', 'Approved', 'Won'].some(s => (quote.status ?? '').toLowerCase() === s.toLowerCase())
    const notAccepted = !(quote.isAccepted === true || acceptedLikeStatus || quote.acceptedAt)

    // Resolve the job + customer from the quote
    const jobId = quote.jobId
    if (!jobId) return NextResponse.json({ error: 'quote_missing_jobId' }, { status: 422 })
    const job = await fergus.getJob(jobId)
    if (!job) return NextResponse.json({ error: 'job_not_found_for_quote', job_id: jobId }, { status: 404 })
    const customerId = (job as unknown as { customerId?: number }).customerId
    if (!customerId) return NextResponse.json({ error: 'job_has_no_customer', job_id: jobId }, { status: 422 })
    const customer = await fergus.getCustomer(customerId)
    if (!customer) return NextResponse.json({ error: 'customer_not_found', customer_id: customerId }, { status: 404 })

    const customerName = customer.customerFullName || 'Customer'
    const mainContact = customer.mainContact as { contactItems?: FergusContactItem[] } | undefined
    const email = mainContact?.contactItems?.find(c => c.contactType === 'email')?.contactValue
    const phone = mainContact?.contactItems?.find(c => c.contactType === 'mobile' || c.contactType === 'phone')?.contactValue

    // Flatten quote sections → Xero line items
    const flat = flattenLineItems(quote.sections)
    const lineItems: XeroLineItem[] = []
    for (const { section, line } of flat) {
      const qty = typeof line.itemQuantity === 'number' ? line.itemQuantity : 1
      const price = typeof line.itemPrice === 'number' ? line.itemPrice : 0
      if (qty <= 0 || price <= 0) continue
      const label = line.combinedItemName || line.itemName || line.itemDescription || (line.isLabour ? 'Labour' : 'Item')
      lineItems.push({
        Description: section ? `${section} — ${label}` : label,
        Quantity: qty,
        UnitAmount: price,
        ...(d.tax_type ? { TaxType: d.tax_type } : {}),
      })
    }

    if (lineItems.length === 0) {
      return NextResponse.json({ error: 'no_billable_lines', reason: 'Quote has no priced line items.' }, { status: 422 })
    }

    // Find-or-create Xero contact
    let xeroContactId: string | undefined
    const matches = await xero.listContacts(customerName).catch(() => [])
    const exact = matches.find(c => c.Name?.toLowerCase() === customerName.toLowerCase())
    if (exact) xeroContactId = exact.ContactID
    else {
      const created = await xero.createContact({
        Name: customerName,
        ...(email ? { EmailAddress: email } : {}),
        ...(phone ? { Phone: phone } : {}),
      })
      xeroContactId = created.ContactID
    }

    const dueDays = d.due_days ?? 14
    const today = new Date()
    const due = new Date(today.getTime() + dueDays * 86_400_000)
    const iso = (dt: Date) => dt.toISOString().slice(0, 10)

    const invoice = await xero.createInvoice({
      Type: 'ACCREC',
      Contact: { ContactID: xeroContactId! },
      Date: iso(today),
      DueDate: iso(due),
      LineItems: lineItems,
      Reference: d.reference ?? `Fergus Quote ${quote.title ?? quoteId} (Job ${(job as { jobNo?: string }).jobNo ?? jobId})`,
      Status: d.status ?? 'DRAFT',
      LineAmountTypes: d.line_amount_types ?? 'Exclusive',
    })

    let emailed = false
    if (d.status === 'AUTHORISED' && d.send_email) {
      await xero.emailInvoice(invoice.InvoiceID).catch(() => {})
      emailed = true
    }

    const sb = supa()
    await sb.from('comms_log').insert({
      client_id: auth.clientId,
      kind: 'fergus_quote_invoiced_via_xero',
      summary: `Quote ${quote.title ?? quoteId} → Xero invoice ${invoice.InvoiceNumber ?? invoice.InvoiceID}`,
      meta: {
        fergus_quote_id: quoteId,
        fergus_job_id: jobId,
        xero_invoice_id: invoice.InvoiceID,
        xero_invoice_number: invoice.InvoiceNumber,
        line_count: lineItems.length,
        accepted_guard_passed: !notAccepted,
      },
    }).then(() => {}, () => {})

    const total = lineItems.reduce((s, li) => s + li.Quantity * li.UnitAmount, 0)
    return NextResponse.json({
      ok: true,
      warnings: notAccepted ? ['Quote does not appear to be accepted yet (no isAccepted/acceptedAt/Accepted-status flag). Invoice still created — verify with owner.'] : [],
      xero: {
        invoice_id: invoice.InvoiceID,
        invoice_number: invoice.InvoiceNumber,
        status: d.status ?? 'DRAFT',
        total_exclusive_of_tax: Number(total.toFixed(2)),
        line_items: lineItems.length,
        deeplink: `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoice.InvoiceID}`,
        emailed,
      },
      fergus: {
        quote_id: quoteId,
        quote_title: quote.title,
        job_id: jobId,
        customer: customerName,
      },
      warning_caveat: 'Invoice lives in Xero only — Fergus job P&L does not include it.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'quote_invoice_via_xero_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
