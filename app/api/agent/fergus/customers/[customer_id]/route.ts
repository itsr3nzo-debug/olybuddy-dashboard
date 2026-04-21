import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

function parseId(s: string): number | null {
  const n = parseInt(s, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ customer_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { customer_id } = await params
  const id = parseId(customer_id)
  if (!id) return NextResponse.json({ error: 'invalid customer_id' }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customer = await client.getCustomer(id)
    if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ customer })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_get_customer_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ customer_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { customer_id } = await params
  const id = parseId(customer_id)
  if (!id) return NextResponse.json({ error: 'invalid customer_id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customer = await client.updateCustomer(id, {
      customerFullName: body.customer_full_name,
      mainContact: body.main_contact,
      physicalAddress: body.physical_address,
      postalAddress: body.postal_address,
    })
    return NextResponse.json({ customer })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_update_customer_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
