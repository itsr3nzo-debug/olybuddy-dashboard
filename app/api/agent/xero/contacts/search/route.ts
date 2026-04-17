/**
 * GET /api/agent/xero/contacts/search?q=Smith
 *
 * Returns matching Xero contacts so Nexley can provide context on incoming enquiries
 * ("is this a repeat customer? what's their LTV?").
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const q = new URL(req.url).searchParams.get('q') ?? ''
  if (q.length < 2) {
    return NextResponse.json({ error: 'q must be ≥2 chars' }, { status: 400 })
  }

  let xero: XeroClient
  try {
    xero = await XeroClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Xero not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  try {
    const contacts = await xero.listContacts(q)
    const summary = contacts.slice(0, 10).map(c => ({
      contact_id: c.ContactID,
      name: c.Name,
      email: c.EmailAddress ?? null,
      phone: c.Phones?.find(p => p.PhoneType === 'MOBILE' || p.PhoneType === 'DEFAULT')?.PhoneNumber ?? null,
      is_subcontractor: c.IsSubcontractor ?? false,
      updated_at: c.UpdatedDateUTC ?? null,
    }))
    return NextResponse.json({ count: summary.length, contacts: summary })
  } catch (e) {
    return NextResponse.json({ error: 'Xero fetch failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
