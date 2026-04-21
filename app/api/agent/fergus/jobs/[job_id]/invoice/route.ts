import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/invoice — generate a Fergus invoice from a completed job.
 * If Xero is connected in Fergus, this will auto-sync the invoice into Xero.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const invoice = await client.generateInvoiceFromJob(id)
    return NextResponse.json({ invoice })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_invoice_job_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
