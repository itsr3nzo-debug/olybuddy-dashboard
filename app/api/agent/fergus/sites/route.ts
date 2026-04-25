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

/** GET /api/agent/fergus/sites?customer_id=N */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const customerIdRaw = new URL(req.url).searchParams.get('customer_id')
  const customerId = customerIdRaw ? parseInt(customerIdRaw, 10) : undefined
  if (customerIdRaw && (!Number.isFinite(customerId) || (customerId as number) <= 0)) {
    return NextResponse.json({ error: 'invalid customer_id' }, { status: 400 })
  }
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const sites = await client.listSites(customerId)
    return NextResponse.json({ count: sites.length, sites })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_list_sites_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

/**
 * POST /api/agent/fergus/sites — create a site
 *
 * Fergus Partner API requires `defaultContact.firstName` + a non-empty
 * `siteAddress.address1`. Three input shapes accepted:
 *
 *   1. Shortcut — pass `customer_id` alone and we copy the customer's
 *      `mainContact` + `physicalAddress` to the new site (mirrors the
 *      Fergus UI's "same as customer" button).
 *
 *   2. Fergus-native (recommended for LLM agents):
 *      {
 *        "name": "Site name",
 *        "defaultContact": { "firstName": "...", "lastName": "...",
 *                            "email": "...", "mobile": "..." },
 *        "siteAddress":    { "address1": "...", "addressCity": "...",
 *                            "addressPostcode": "...",
 *                            "addressCountry": "United Kingdom" },
 *        "billingContact": { ... },   // optional
 *        "postalAddress":  { ... }    // optional
 *      }
 *
 *   3. Snake_case (legacy proxy shape — still accepted):
 *      `default_contact.first_name`, `site_address.address_line1`, etc.
 *
 * Don't mix shapes in one request.
 */
const CreateBody = z.object({
  // Shortcut — if present and nothing else is, we auto-copy from customer
  customer_id: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  // Site name (either casing)
  name: z.string().max(200).optional(),
  // Default contact (either top-level + either inner casing)
  default_contact: FergusContactInput.optional(),
  defaultContact: FergusContactInput.optional(),
  // Site address (either top-level + either inner casing)
  site_address: FergusAddressInput.optional(),
  siteAddress: FergusAddressInput.optional(),
  // Optional billing contact + postal
  billing_contact: FergusContactInput.optional(),
  billingContact: FergusContactInput.optional(),
  postal_address: FergusAddressInput.optional(),
  postalAddress: FergusAddressInput.optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const d = parsed.data

  const customerId = d.customer_id ?? d.customerId
  const defaultContactInput = d.default_contact ?? d.defaultContact
  const siteAddressInput = d.site_address ?? d.siteAddress
  const billingContactInput = d.billing_contact ?? d.billingContact
  const postalAddressInput = d.postal_address ?? d.postalAddress

  try {
    const client = await FergusClient.forClient(auth.clientId)

    let defaultContact: { firstName: string; lastName?: string; email?: string; mobile?: string; phone?: string } | undefined
    let siteAddress: ReturnType<typeof toFergusAddress>
    let siteName: string | undefined

    // Shortcut path: customer_id only → copy contact + address from the customer.
    if (customerId && !defaultContactInput && !siteAddressInput) {
      const cust = await client.getCustomer(customerId)
      if (!cust) {
        return NextResponse.json(
          { error: 'customer not found', customer_id: customerId },
          { status: 404 },
        )
      }
      const mc = cust.mainContact as { firstName?: string; lastName?: string; contactItems?: Array<{ contactType: string; contactValue: string }> } | undefined
      const pa = cust.physicalAddress as Record<string, string> | undefined

      // Derive firstName/lastName. Preference order:
      //   1. mainContact.firstName (+lastName)
      //   2. Split customerFullName on whitespace
      // Without this fallback, company-only rows ("ACME Ltd" with no
      // mainContact) blocked site creation entirely.
      let firstName: string | undefined = mc?.firstName?.trim()
      let lastName: string | undefined = mc?.lastName?.trim()
      if (!firstName) {
        const full = (cust.customerFullName ?? '').trim()
        if (!full) {
          return NextResponse.json({
            error: 'customer has no mainContact.firstName AND no customerFullName — pass defaultContact + siteAddress explicitly',
            customer_id: customerId,
          }, { status: 422 })
        }
        const parts = full.split(/\s+/)
        firstName = parts[0]
        lastName = parts.slice(1).join(' ') || undefined
      }
      const email = mc?.contactItems?.find(c => c.contactType === 'email')?.contactValue
      const mobile = mc?.contactItems?.find(c => c.contactType === 'mobile')?.contactValue
      const phone = mc?.contactItems?.find(c => c.contactType === 'phone')?.contactValue
      defaultContact = { firstName, lastName, email, mobile, phone }
      siteAddress = toFergusAddress({
        address1: pa?.address1,
        address2: pa?.address2,
        addressSuburb: pa?.addressSuburb,
        addressCity: pa?.addressCity,
        addressPostcode: pa?.addressPostcode,
        addressCountry: pa?.addressCountry,
      })
      siteName = cust.customerFullName
    } else {
      // Explicit path — caller passed defaultContact + siteAddress.
      const contact = toFergusContact(defaultContactInput)
      if (!contact?.firstName) {
        return NextResponse.json(
          { error: 'defaultContact.firstName is required (or pass customer_id alone to auto-copy from customer)' },
          { status: 400 },
        )
      }
      siteAddress = toFergusAddress(siteAddressInput)
      if (!siteAddress?.address1) {
        return NextResponse.json(
          {
            error: 'siteAddress.address1 is required and must be non-empty',
            hint: 'Pass `siteAddress.address1` (Fergus-native) or `site_address.address_line1` (legacy). Empty strings are rejected by Fergus.',
          },
          { status: 400 },
        )
      }
      defaultContact = {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        mobile: contact.mobile,
        phone: contact.phone,
      }
      siteName = d.name
    }

    if (!siteAddress?.address1) {
      return NextResponse.json(
        {
          error: 'siteAddress.address1 missing — customer has no physicalAddress on file. PATCH the customer first or pass siteAddress explicitly.',
          customer_id: customerId,
        },
        { status: 422 },
      )
    }

    const site = await client.createSite({
      defaultContact,
      siteAddress,
      name: siteName,
      billingContact: toFergusContact(billingContactInput),
      postalAddress: toFergusAddress(postalAddressInput),
    })
    return NextResponse.json({ site })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_create_site_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
