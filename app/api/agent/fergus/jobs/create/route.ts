/**
 * POST /api/agent/fergus/jobs/create
 *
 * VPS agent uses this to push a captured job (voice-note / WhatsApp enquiry)
 * into the owner's Fergus board. Always DRAFT by default so the owner reviews
 * in Fergus before finalising — perfect fit with our trust-gate model.
 *
 * Body:
 * {
 *   job_type?: "Quote" | "Estimate" | "Charge Up"  // defaults to "Quote" — Fergus Partner API ONLY accepts these three enum values.
 *   title: string                                  // short summary — shown in Fergus list
 *   description?: string                           // fuller detail — what needs doing
 *   customer_name: string
 *   customer_phone?: string
 *   customer_email?: string
 *   customer_id?: number                           // if we already know their Fergus ID
 *   site_address?: FergusAddress                   // physical address of the job
 *   customer_reference?: string                    // e.g., "Job #2026-042"
 *   is_draft?: boolean                             // default true (recommended)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, logAgentAction } from '@/lib/agent-auth'
import { enforceTrust, safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const {
    job_type = 'Quote',
    title,
    description,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    site_id,                              // explicit site reference (preferred)
    site_address,                         // used during customer create (NOT on the job body)
    use_customer_address_as_site = true,  // default: auto-derive site from customer — matches Fergus UI's "same as customer" button
    customer_reference,
    is_draft = true,
  } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }
  if (!customer_id && !customer_name) {
    return NextResponse.json({ error: 'customer_id OR customer_name required' }, { status: 400 })
  }

  // Creating a draft Fergus job = draft_write.
  // Creating a non-draft (finalised) job = send_big_external because it enters Fergus workflow,
  // becomes scheduled, etc. Treat accordingly.
  const actionClass = is_draft ? 'draft_write' : 'send_big_external'
  const trust = enforceTrust(auth, actionClass)
  if (!trust.allowed) return trust.response!

  let fergus: FergusClient
  try {
    fergus = await FergusClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Fergus not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  // Resolve customer: use provided ID, else search, else create
  let resolvedCustomerId = customer_id as number | undefined
  if (!resolvedCustomerId) {
    try {
      const existing = await fergus.searchCustomers(customer_name)
      const match = existing.find(c => c.customerFullName.toLowerCase() === customer_name.toLowerCase())
      if (match) {
        resolvedCustomerId = match.id
      } else {
        const [firstName, ...rest] = customer_name.split(/\s+/)
        const created = await fergus.createCustomer({
          customerFullName: customer_name,
          mainContact: {
            firstName: firstName ?? customer_name,
            lastName: rest.join(' ') || undefined,
            email: customer_email,
            mobile: customer_phone,
          },
          physicalAddress: site_address,
        })
        resolvedCustomerId = created.id
      }
    } catch (e) {
      return NextResponse.json({ error: 'Customer lookup/create failed', detail: safeErrorDetail(e) }, { status: 502 })
    }
  }

  // Resolve site: explicit site_id wins; else (if use_customer_address_as_site) auto-create
  // a site from the customer's physicalAddress + mainContact — mirrors Fergus UI's
  // "same as customer" button. Sites are REQUIRED for non-draft jobs.
  let resolvedSiteId: number | undefined = typeof site_id === 'number' ? site_id : undefined
  let autoSiteNote: string | null = null
  if (!resolvedSiteId && use_customer_address_as_site && resolvedCustomerId) {
    try {
      const cust = await fergus.getCustomer(resolvedCustomerId)
      const mc = cust?.mainContact as { firstName?: string; lastName?: string; contactItems?: Array<{ contactType: string; contactValue: string }> } | undefined
      const pa = cust?.physicalAddress as Record<string, string> | undefined
      // Check the customer has enough for a usable site: firstName + non-empty address1.
      const usableAddress1 = (pa?.address1 ?? '').trim()
      if (!mc?.firstName) {
        autoSiteNote = 'customer has no mainContact.firstName — cannot auto-create site'
      } else if (!usableAddress1) {
        autoSiteNote = `customer "${cust?.customerFullName}" has no street address on file — site not auto-created. Set customer's physicalAddress first, or pass site_id on job create.`
      } else {
        const site = await fergus.createSite({
          defaultContact: {
            firstName: mc.firstName,
            lastName: mc.lastName,
            email: mc.contactItems?.find(c => c.contactType === 'email')?.contactValue,
            mobile: mc.contactItems?.find(c => c.contactType === 'mobile')?.contactValue,
            phone: mc.contactItems?.find(c => c.contactType === 'phone')?.contactValue,
          },
          siteAddress: {
            address1: pa?.address1,
            address2: pa?.address2,
            addressSuburb: pa?.addressSuburb,
            addressCity: pa?.addressCity,
            addressPostcode: pa?.addressPostcode,
            addressCountry: pa?.addressCountry,
          },
          name: cust?.customerFullName,
        })
        resolvedSiteId = (site as { id?: number })?.id
      }
    } catch (e) {
      autoSiteNote = `auto-site-from-customer failed: ${safeErrorDetail(e)}`
    }
  }

  // Fergus rule: non-draft jobs REQUIRE siteId. Force-downgrade to draft if we don't have one.
  const finalIsDraft = is_draft || !resolvedSiteId

  // Create the job
  let job
  try {
    job = await fergus.createJob({
      jobType: job_type,
      title,
      description,
      customerId: resolvedCustomerId,
      siteId: resolvedSiteId,
      customerReference: customer_reference,
      isDraft: finalIsDraft,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Fergus createJob failed', detail: safeErrorDetail(e) }, { status: 502 })
  }

  await logAgentAction({
    clientId: auth.clientId,
    category: 'job_captured',
    skillUsed: 'push-to-fergus',
    summary: `Fergus ${is_draft ? 'draft' : 'active'} job "${title.slice(0, 60)}" created for ${customer_name}`,
    outcomeTag: 'n_a',
    contactName: customer_name,
    contactPhone: customer_phone,
    meta: {
      fergus_job_id: job.id,
      fergus_job_no: job.jobNo,
      fergus_customer_id: resolvedCustomerId,
      is_draft,
    },
  })

  return NextResponse.json({
    fergus_job_id: job.id,
    fergus_job_no: job.jobNo ?? null,
    is_draft: job.isDraft ?? finalIsDraft,
    customer_id: resolvedCustomerId,
    site_id: resolvedSiteId ?? null,
    customer_name,
    fergus_link: job.jobNo ? `https://app.fergus.com/jobs/${job.id}` : null,
    // Transparent diagnostic so the agent can tell the owner why a draft wasn't finalised.
    auto_site_note: autoSiteNote,
  })
}
