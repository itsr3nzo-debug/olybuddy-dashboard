import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import { z } from 'zod'

const Body = z.object({
  customer_full_name: z.string().min(2).max(200),
  main_contact: z.object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    email: z.string().email().optional(),
    mobile: z.string().max(40).optional(),
    phone: z.string().max(40).optional(),
  }),
  physical_address: z.object({
    address_line1: z.string().max(200).optional(),
    address_line2: z.string().max(200).optional(),
    address_suburb: z.string().max(100).optional(),
    address_city: z.string().max(100).optional(),
    address_postcode: z.string().max(20).optional(),
    address_country: z.string().max(100).optional(),
  }).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customer = await client.createCustomer({
      customerFullName: d.customer_full_name,
      mainContact: {
        firstName: d.main_contact.first_name,
        lastName: d.main_contact.last_name,
        email: d.main_contact.email,
        mobile: d.main_contact.mobile,
        phone: d.main_contact.phone,
      },
      physicalAddress: d.physical_address ? {
        address1: d.physical_address.address_line1,
        address2: d.physical_address.address_line2,
        addressSuburb: d.physical_address.address_suburb,
        addressCity: d.physical_address.address_city,
        addressPostcode: d.physical_address.address_postcode,
        addressCountry: d.physical_address.address_country,
      } : undefined,
    })
    return NextResponse.json({ customer })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_create_customer_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
