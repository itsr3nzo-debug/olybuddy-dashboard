/**
 * GET  /api/agent/fergus/jobs/<id>   — fetch single job
 * PATCH /api/agent/fergus/jobs/<id>  — update title/description/status/jobType
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { toFergusAddress, toFergusContact } from '@/lib/integrations/fergus-input'

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

    // Convenience: if caller passes `site_address` (or `siteAddress`)
    // instead of `site_id`, auto-create a site first and link by id
    // (Fergus doesn't accept inline addresses on jobs). Accepts both
    // camelCase (Fergus-native) and snake_case via toFergusAddress.
    let siteIdToSet: number | undefined = body.site_id ?? body.siteId
    const inlineSiteAddress = toFergusAddress(body.site_address ?? body.siteAddress)
    const inlineDefaultContact = toFergusContact(body.default_contact ?? body.defaultContact)
    if (!siteIdToSet && inlineSiteAddress?.address1 && inlineDefaultContact?.firstName) {
      const site = await client.createSite({
        defaultContact: inlineDefaultContact,
        siteAddress: inlineSiteAddress,
      })
      siteIdToSet = (site as { id?: number })?.id
    }

    const job = await client.updateJob(id, {
      title: body.title,
      description: body.description,
      status: body.status,
      jobType: body.job_type ?? body.jobType,
      customerId: body.customer_id ?? body.customerId,
      siteId: siteIdToSet,
    })
    return NextResponse.json({ job })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_update_job_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
