import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

function assertGuid(id: string) {
  return /^[a-f0-9-]{36}$/i.test(id)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ contact_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { contact_id } = await params
  if (!assertGuid(contact_id)) return NextResponse.json({ error: 'invalid contact_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const contact = await client.getContact(contact_id)
    if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ contact })
  } catch (e) {
    return NextResponse.json({ error: 'xero_get_contact_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ contact_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { contact_id } = await params
  if (!assertGuid(contact_id)) return NextResponse.json({ error: 'invalid contact_id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const contact = await client.updateContact(contact_id, {
      Name: body.name,
      EmailAddress: body.email,
      Phone: body.phone,
      IsSubcontractor: body.is_subcontractor,
    })
    return NextResponse.json({ contact })
  } catch (e) {
    return NextResponse.json({ error: 'xero_update_contact_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
