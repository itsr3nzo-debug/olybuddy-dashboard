import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
import {
  FergusAddressInput,
  FergusContactInput,
  toFergusAddress,
  toFergusContact,
} from '@/lib/integrations/fergus-input'
import { z } from 'zod'

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

/**
 * PATCH /api/agent/fergus/customers/<id>
 *
 * Same dual-shape acceptance as POST /create — Fergus-native camelCase
 * (`physicalAddress.address1`) or our legacy snake_case
 * (`physical_address.address_line1`). Pre-fix this route trusted the
 * raw body and mapped only the snake_case keys, so PATCHing with the
 * Fergus-native shape silently dropped every address field.
 */
const PatchBody = z.object({
  customer_full_name: z.string().min(2).max(200).optional(),
  customerFullName: z.string().min(2).max(200).optional(),
  main_contact: FergusContactInput.optional(),
  mainContact: FergusContactInput.optional(),
  physical_address: FergusAddressInput.optional(),
  physicalAddress: FergusAddressInput.optional(),
  postal_address: FergusAddressInput.optional(),
  postalAddress: FergusAddressInput.optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ customer_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { customer_id } = await params
  const id = parseId(customer_id)
  if (!id) return NextResponse.json({ error: 'invalid customer_id' }, { status: 400 })

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const d = parsed.data

  const customerFullName = d.customer_full_name ?? d.customerFullName
  const mainContact = toFergusContact(d.main_contact ?? d.mainContact)
  const physicalAddress = toFergusAddress(d.physical_address ?? d.physicalAddress)
  const postalAddress = toFergusAddress(d.postal_address ?? d.postalAddress)

  // No-op guard — if the body is empty/whitespace, don't bother round-tripping
  // to Fergus (it would happily echo the existing record back). Tells the
  // agent "you sent nothing" instead of pretending everything succeeded.
  if (!customerFullName && !mainContact && physicalAddress === undefined && postalAddress === undefined) {
    return NextResponse.json(
      { error: 'no recognisable fields in body — see /api/agent/fergus/customers/create for shape' },
      { status: 400 },
    )
  }

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customer = await client.updateCustomer(id, {
      customerFullName: customerFullName?.trim(),
      mainContact,
      physicalAddress,
      postalAddress,
    })
    return NextResponse.json({ customer })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_update_customer_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
