import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { XeroClient, type XeroLineItem } from '@/lib/integrations/xero'

/**
 * POST /api/agent/fergus/jobs/<id>/invoice-via-xero
 *
 * Workaround E — since Fergus Partner API has no invoice-create endpoint,
 * short-circuit through Xero: pull the Fergus job's phase line items,
 * find/create the Xero contact, create the Xero invoice.
 *
 * Defaults to DRAFT + Exclusive tax. Agent should NEVER auto-AUTHORISE —
 * the owner must approve before the invoice is sent. If `status: "AUTHORISED"`
 * is passed we do it, but the downstream agent prompt must have confirmed
 * with the owner first.
 *
 * Caveat (and this matters): the Fergus-side invoice record DOES NOT get
 * created by this route. Only the Xero one. If the customer cares about
 * the Fergus Job P&L being accurate, they still need to hit the Fergus
 * "Invoice" button in the UI (use `/invoice-ready` for that deeplink).
 * This route is for "get paid faster" when the Fergus P&L view isn't the
 * priority.
 *
 * Body:
 *   - due_days: int, default 14
 *   - status: 'DRAFT'|'AUTHORISED', default 'DRAFT'
 *   - reference: string, optional (default = "Fergus Job {jobNo}")
 *   - send_email: bool, default false (only applied if status=AUTHORISED)
 *   - include_labour: bool, default true
 *   - include_materials: bool, default true
 *   - line_amount_types: 'Exclusive'|'Inclusive'|'NoTax', default Exclusive
 *   - tax_type: Xero TaxType string, optional (e.g. OUTPUT2 for 20% VAT)
 */

const Body = z.object({
  due_days: z.number().int().min(1).max(180).optional(),
  status: z.enum(['DRAFT', 'AUTHORISED']).optional(),
  reference: z.string().max(200).optional(),
  send_email: z.boolean().optional(),
  include_labour: z.boolean().optional(),
  include_materials: z.boolean().optional(),
  line_amount_types: z.enum(['Exclusive', 'Inclusive', 'NoTax']).optional(),
  tax_type: z.string().max(50).optional(),
})

type StockItem = {
  id?: number
  itemDescription?: string
  itemPrice?: number
  itemQuantity?: number
  isLabour?: boolean
  isInvoiced?: boolean
}

type FergusContactItem = { contactType?: string; contactValue?: string }

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const jobId = parseInt(job_id, 10)
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data

  try {
    const fergus = await FergusClient.forClient(auth.clientId)
    const xero = await XeroClient.forClient(auth.clientId)

    // 1. Load job + customer + phases
    const job = await fergus.getJob(jobId)
    if (!job) return NextResponse.json({ error: 'job_not_found', job_id: jobId }, { status: 404 })

    const jobNo = (job as unknown as { jobNo?: string }).jobNo
    const customerId = (job as unknown as { customerId?: number }).customerId
    if (!customerId) {
      return NextResponse.json({ error: 'job_has_no_customer', job_id: jobId }, { status: 422 })
    }
    const customer = await fergus.getCustomer(customerId)
    if (!customer) return NextResponse.json({ error: 'customer_not_found', customer_id: customerId }, { status: 404 })

    const customerName = customer.customerFullName || 'Customer'
    const mainContact = customer.mainContact as { contactItems?: FergusContactItem[] } | undefined
    const email = mainContact?.contactItems?.find(c => c.contactType === 'email')?.contactValue
    const phone = mainContact?.contactItems?.find(c => c.contactType === 'mobile' || c.contactType === 'phone')?.contactValue

    // 2. Load every open (non-voided) phase's stockOnHand
    const phases = (await fergus.listJobPhases(jobId)) as Array<{ id?: number; title?: string; isVoided?: boolean; status?: string }>
    const openPhases = phases.filter(p => !p.isVoided && p.status !== 'Voided')
    if (openPhases.length === 0) {
      return NextResponse.json({ error: 'no_open_phases', reason: 'Nothing to invoice — job has no non-voided phases.' }, { status: 422 })
    }

    const includeLabour = d.include_labour ?? true
    const includeMaterials = d.include_materials ?? true
    const lineItems: XeroLineItem[] = []
    let totalSkipped = 0
    for (const phase of openPhases) {
      if (!phase.id) continue
      const items = (await fergus.listPhaseStockOnHand(phase.id)) as StockItem[]
      for (const item of items) {
        if (item.isInvoiced) { totalSkipped++; continue } // don't double-bill
        if (item.isLabour && !includeLabour) continue
        if (!item.isLabour && !includeMaterials) continue
        const qty = typeof item.itemQuantity === 'number' ? item.itemQuantity : 1
        const price = typeof item.itemPrice === 'number' ? item.itemPrice : 0
        if (qty <= 0 || price <= 0) continue
        lineItems.push({
          Description: `${phase.title ? phase.title + ' — ' : ''}${item.itemDescription ?? (item.isLabour ? 'Labour' : 'Materials')}`,
          Quantity: qty,
          UnitAmount: price,
          ...(d.tax_type ? { TaxType: d.tax_type } : {}),
        })
      }
    }

    if (lineItems.length === 0) {
      return NextResponse.json({
        error: 'no_billable_lines',
        reason: 'No line items with non-zero price/qty found on this job. Add materials/labour first, then retry.',
        phases_checked: openPhases.length,
        items_marked_already_invoiced: totalSkipped,
      }, { status: 422 })
    }

    // 3. Find-or-create the Xero contact
    let xeroContactId: string | undefined
    const matches = await xero.listContacts(customerName).catch(() => [])
    const exact = matches.find(c => c.Name?.toLowerCase() === customerName.toLowerCase())
    if (exact) {
      xeroContactId = exact.ContactID
    } else {
      const created = await xero.createContact({
        Name: customerName,
        ...(email ? { EmailAddress: email } : {}),
        ...(phone ? { Phone: phone } : {}),
      })
      xeroContactId = created.ContactID
    }

    // 4. Create the Xero invoice
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
      Reference: d.reference ?? `Fergus Job ${jobNo ?? jobId}`,
      Status: d.status ?? 'DRAFT',
      LineAmountTypes: d.line_amount_types ?? 'Exclusive',
    })

    // 5. Optionally email it (only when AUTHORISED, else Xero rejects)
    let emailed = false
    if (d.status === 'AUTHORISED' && d.send_email) {
      await xero.emailInvoice(invoice.InvoiceID).catch(() => {})
      emailed = true
    }

    // 6. Shadow log — so we know this job was invoiced-via-xero (not via Fergus)
    const sb = supa()
    await sb.from('comms_log').insert({
      client_id: auth.clientId,
      kind: 'fergus_job_invoiced_via_xero',
      summary: `Job ${jobNo ?? jobId} invoiced via Xero (not Fergus UI) — Xero invoice ${invoice.InvoiceNumber ?? invoice.InvoiceID}`,
      meta: {
        fergus_job_id: jobId,
        fergus_job_no: jobNo,
        xero_invoice_id: invoice.InvoiceID,
        xero_invoice_number: invoice.InvoiceNumber,
        line_count: lineItems.length,
        status: d.status ?? 'DRAFT',
        emailed,
      },
    }).then(() => {}, () => {})

    const total = lineItems.reduce((s, li) => s + li.Quantity * li.UnitAmount, 0)
    return NextResponse.json({
      ok: true,
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
        job_id: jobId,
        job_no: jobNo,
        customer: customerName,
        phases_billed: openPhases.length,
        items_skipped_already_invoiced: totalSkipped,
      },
      warning: 'This invoice lives in Xero only. It will NOT show in Fergus\'s job P&L view. Use /api/agent/fergus/jobs/{id}/invoice-ready instead if you need the Fergus-side record.',
    })
  } catch (e) {
    return NextResponse.json({ error: 'invoice_via_xero_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
