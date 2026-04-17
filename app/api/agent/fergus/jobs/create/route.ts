/**
 * POST /api/agent/fergus/jobs/create
 *
 * The flagship Fergus action: VPS agent receives a voice note or WhatsApp
 * enquiry, extracts the job details, and pushes them to Julian's Fergus
 * dashboard. This replaces the manual "type it in later" step that kills
 * trades ops productivity.
 *
 * Body:
 * {
 *   customer_name: string,
 *   customer_phone?: string,
 *   customer_email?: string,
 *   site_address?: string,
 *   description: string,          // the work — "Fuse board replacement + RCBO upgrade"
 *   estimated_value_gbp?: number,
 *   scheduled_for?: "YYYY-MM-DD",
 *   internal_notes?: string,      // anything the owner should see but not the customer
 *   source?: string               // defaults to "Nexley (WhatsApp)"
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
  const { customer_name, customer_phone, customer_email, site_address, description, estimated_value_gbp, scheduled_for, internal_notes, source } = body

  if (!customer_name || !description) {
    return NextResponse.json({ error: 'customer_name and description required' }, { status: 400 })
  }

  // Creating a Fergus job is a draft_write (visible to owner in Fergus but not yet invoiced).
  // Blocked at TL=0 (shadow mode).
  const trust = enforceTrust(auth, 'draft_write', estimated_value_gbp)
  if (!trust.allowed) return trust.response!

  let fergus: FergusClient
  try {
    fergus = await FergusClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Fergus not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  let job
  try {
    job = await fergus.createJob({
      customer_name,
      customer_phone,
      customer_email,
      site_address,
      description,
      estimated_value_pence: typeof estimated_value_gbp === 'number' ? Math.round(estimated_value_gbp * 100) : undefined,
      scheduled_for,
      internal_notes,
      source: source ?? 'Nexley (WhatsApp)',
    })
  } catch (e) {
    return NextResponse.json({ error: 'Fergus createJob failed', detail: safeErrorDetail(e) }, { status: 502 })
  }

  await logAgentAction({
    clientId: auth.clientId,
    category: 'job_captured',
    skillUsed: 'push-to-fergus',
    summary: `Fergus job #${job.job_number ?? job.id} created — ${customer_name} — ${description.slice(0, 80)}`,
    outcomeTag: 'n_a',
    valueGbp: estimated_value_gbp,
    contactName: customer_name,
    contactPhone: customer_phone,
    meta: { fergus_job_id: job.id, fergus_job_number: job.job_number, status: job.status },
  })

  return NextResponse.json({
    fergus_job_id: job.id,
    fergus_job_number: job.job_number ?? null,
    status: job.status,
    customer_name: job.customer?.name ?? customer_name,
  })
}
