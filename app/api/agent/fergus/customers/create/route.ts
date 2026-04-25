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

/**
 * POST /api/agent/fergus/customers/create
 *
 * Accepts BOTH camelCase (Fergus-native — what the Partner API itself
 * uses) and snake_case (our legacy proxy shape). Pick whichever you
 * prefer; the route normalises before calling Fergus.
 *
 * Recommended (Fergus-native):
 * {
 *   "customerFullName": "James Harrison",
 *   "mainContact":     { "firstName": "James", "lastName": "Harrison",
 *                        "email": "...", "mobile": "..." },
 *   "physicalAddress": { "address1": "42 Duchy Road",
 *                        "addressCity": "Harrogate",
 *                        "addressPostcode": "HG2 0QP",
 *                        "addressCountry": "United Kingdom" },
 *   "postalAddress":   { ... }    // optional
 * }
 *
 * Legacy snake_case is still accepted (`customer_full_name`,
 * `main_contact`, `physical_address`, plus `address_line1` /
 * `address_city` etc.). Don't mix shapes in one request — pick one.
 */
const Body = z.object({
  // Customer name (either casing accepted)
  customer_full_name: z.string().min(2).max(200).optional(),
  customerFullName: z.string().min(2).max(200).optional(),
  // Main contact (either top-level + either inner casing)
  main_contact: FergusContactInput.optional(),
  mainContact: FergusContactInput.optional(),
  // Addresses (either top-level + either inner casing)
  physical_address: FergusAddressInput.optional(),
  physicalAddress: FergusAddressInput.optional(),
  postal_address: FergusAddressInput.optional(),
  postalAddress: FergusAddressInput.optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const d = parsed.data

  const customerFullName = (d.customer_full_name ?? d.customerFullName ?? '').trim()
  if (customerFullName.length < 2) {
    return NextResponse.json(
      { error: 'customer_full_name (or customerFullName) is required (min 2 chars)' },
      { status: 400 },
    )
  }

  const mainContact = toFergusContact(d.main_contact ?? d.mainContact) ?? {}
  const physicalAddress = toFergusAddress(d.physical_address ?? d.physicalAddress)
  const postalAddress = toFergusAddress(d.postal_address ?? d.postalAddress)

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customer = await client.createCustomer({
      customerFullName,
      mainContact,
      physicalAddress,
      postalAddress,
    })
    return NextResponse.json({ customer })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_create_customer_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
