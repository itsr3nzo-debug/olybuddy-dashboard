/**
 * POST /api/agent/fergus/jobs/create
 *
 * VPS agent uses this to push a captured job (voice-note / WhatsApp enquiry)
 * into the owner's Fergus board. Always DRAFT by default so the owner reviews
 * in Fergus before finalising — perfect fit with our trust-gate model.
 *
 * Body:
 * {
 *   job_type?: "Service Call" | "Install" | ...    // defaults to "Service Call"
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
    job_type = 'Service Call',
    title,
    description,
    customer_name,
    customer_phone,
    customer_email,
    customer_id,
    site_address,
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

  // Create the job (draft by default)
  let job
  try {
    job = await fergus.createJob({
      jobType: job_type,
      title,
      description,
      customerId: resolvedCustomerId,
      customerReference: customer_reference,
      isDraft: is_draft,
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
    is_draft: job.isDraft ?? is_draft,
    customer_id: resolvedCustomerId,
    customer_name,
    fergus_link: job.jobNo ? `https://app.fergus.com/jobs/${job.id}` : null,
  })
}
