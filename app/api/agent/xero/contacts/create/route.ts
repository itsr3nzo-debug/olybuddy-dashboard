import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'
import { z } from 'zod'

const Body = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  is_subcontractor: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const contact = await client.createContact({
      Name: parsed.data.name,
      EmailAddress: parsed.data.email,
      Phone: parsed.data.phone,
      IsSubcontractor: parsed.data.is_subcontractor,
    })
    return NextResponse.json({ contact })
  } catch (e) {
    return NextResponse.json({ error: 'xero_create_contact_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
