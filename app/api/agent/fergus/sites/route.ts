import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'
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
 * Fergus site create body — shape required by the Partner API:
 *   {defaultContact, siteAddress, name?, billingContact?, postalAddress?}
 *
 * defaultContact needs at least firstName.
 * Shortcut: pass `customer_id` alone (nothing else) and we'll fetch the
 * customer and use their mainContact + physicalAddress — the "same as
 * customer" button equivalent.
 */
const CreateBody = z.object({
  // Shortcut — if present and nothing else is, we auto-copy from customer
  customer_id: z.number().int().positive().optional(),
  // Or explicit fields
  name: z.string().max(200).optional(),
  default_contact: z.object({
    first_name: z.string().min(1).max(100),   // Fergus requires
    last_name: z.string().max(100).optional(),
    email: z.string().email().optional(),
    mobile: z.string().max(40).optional(),
    phone: z.string().max(40).optional(),
  }).optional(),
  site_address: z.object({
    address_line1: z.string().max(200).optional(),
    address_line2: z.string().max(200).optional(),
    address_suburb: z.string().max(100).optional(),
    address_city: z.string().max(100).optional(),
    address_postcode: z.string().max(20).optional(),
    address_country: z.string().max(100).optional(),
  }).optional(),
  billing_contact: z.object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    email: z.string().email().optional(),
    mobile: z.string().max(40).optional(),
    phone: z.string().max(40).optional(),
  }).optional(),
  postal_address: z.object({
    address_line1: z.string().max(200).optional(),
    address_line2: z.string().max(200).optional(),
    address_suburb: z.string().max(100).optional(),
    address_city: z.string().max(100).optional(),
    address_postcode: z.string().max(20).optional(),
    address_country: z.string().max(100).optional(),
  }).optional(),
})

function mapAddress(a: { address_line1?: string; address_line2?: string; address_suburb?: string; address_city?: string; address_postcode?: string; address_country?: string }) {
  return {
    address1: a.address_line1,
    address2: a.address_line2,
    addressSuburb: a.address_suburb,
    addressCity: a.address_city,
    addressPostcode: a.address_postcode,
    addressCountry: a.address_country,
  }
}

/** POST /api/agent/fergus/sites — create a site */
export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)

    // Short-circuit: customer_id only → copy from customer
    let defaultContact: { firstName: string; lastName?: string; email?: string; mobile?: string; phone?: string } | undefined
    let siteAddress: ReturnType<typeof mapAddress> | undefined
    let siteName: string | undefined

    if (d.customer_id && !d.default_contact && !d.site_address) {
      const cust = await client.getCustomer(d.customer_id)
      if (!cust) return NextResponse.json({ error: 'customer not found', customer_id: d.customer_id }, { status: 404 })
      const mc = cust.mainContact as { firstName?: string; lastName?: string; contactItems?: Array<{ contactType: string; contactValue: string }> } | undefined
      const pa = cust.physicalAddress as Record<string, string> | undefined
      if (!mc?.firstName) {
        return NextResponse.json({ error: 'customer has no mainContact.firstName — cannot auto-derive site defaultContact' }, { status: 422 })
      }
      const email = mc.contactItems?.find(c => c.contactType === 'email')?.contactValue
      const mobile = mc.contactItems?.find(c => c.contactType === 'mobile')?.contactValue
      const phone = mc.contactItems?.find(c => c.contactType === 'phone')?.contactValue
      defaultContact = {
        firstName: mc.firstName,
        lastName: mc.lastName,
        email, mobile, phone,
      }
      siteAddress = {
        address1: pa?.address1,
        address2: pa?.address2,
        addressSuburb: pa?.addressSuburb,
        addressCity: pa?.addressCity,
        addressPostcode: pa?.addressPostcode,
        addressCountry: pa?.addressCountry,
      }
      siteName = cust.customerFullName
    } else {
      if (!d.default_contact?.first_name || !d.site_address) {
        return NextResponse.json({ error: 'need default_contact.first_name AND site_address (or pass customer_id alone to auto-copy from customer)' }, { status: 400 })
      }
      defaultContact = {
        firstName: d.default_contact.first_name,
        lastName: d.default_contact.last_name,
        email: d.default_contact.email,
        mobile: d.default_contact.mobile,
        phone: d.default_contact.phone,
      }
      siteAddress = mapAddress(d.site_address)
      siteName = d.name
    }

    const site = await client.createSite({
      defaultContact,
      siteAddress,
      name: siteName,
      billingContact: d.billing_contact ? {
        firstName: d.billing_contact.first_name,
        lastName: d.billing_contact.last_name,
        email: d.billing_contact.email,
        mobile: d.billing_contact.mobile,
        phone: d.billing_contact.phone,
      } : undefined,
      postalAddress: d.postal_address ? mapAddress(d.postal_address) : undefined,
    })
    return NextResponse.json({ site })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_create_site_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
