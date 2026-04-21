/**
 * GET  /api/agent/fergus/jobs/<id>   — fetch single job
 * PATCH /api/agent/fergus/jobs/<id>  — update title/description/status/jobType
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

function parseId(s: string): number | null {
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseId(job_id)
  if (!id) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const job = await client.getJob(id)
    if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ job })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_get_job_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseId(job_id)
  if (!id) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  try {
    const client = await FergusClient.forClient(auth.clientId)

    // Convenience: if caller passes `site_address` instead of `site_id`, auto-
    // create a site first and link by id (Fergus doesn't accept inline addresses).
    let siteIdToSet: number | undefined = body.site_id
    if (!siteIdToSet && body.site_address && body.default_contact?.first_name) {
      const site = await client.createSite({
        defaultContact: {
          firstName: body.default_contact.first_name,
          lastName: body.default_contact.last_name,
          email: body.default_contact.email,
          mobile: body.default_contact.mobile,
          phone: body.default_contact.phone,
        },
        siteAddress: {
          address1: body.site_address.address_line1,
          address2: body.site_address.address_line2,
          addressSuburb: body.site_address.address_suburb,
          addressCity: body.site_address.address_city,
          addressPostcode: body.site_address.address_postcode,
          addressCountry: body.site_address.address_country,
        },
      })
      siteIdToSet = (site as { id?: number })?.id
    }

    const job = await client.updateJob(id, {
      title: body.title,
      description: body.description,
      status: body.status,
      jobType: body.job_type,
      customerId: body.customer_id,
      siteId: siteIdToSet,
    })
    return NextResponse.json({ job })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_update_job_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
