/**
 * GET /api/agent/fergus/customers/list?pageSize=100&maxPages=40
 *
 * Returns ALL customers for the authenticated agent's client, across every
 * page of Fergus's paginated /customers endpoint. Called by the VPS contact
 * sync job that seeds contacts.json so WhatsApp @lid senders can be
 * resolved to customer names without the owner re-pairing.
 *
 * Response shape:
 *   {
 *     count: number,
 *     customers: Array<{
 *       id, customerFullName, mainContact, physicalAddress,
 *       phones: string[]  // extracted + normalized E.164 numbers
 *     }>
 *   }
 *
 * Phones are extracted from mainContact.mobile / mainContact.phone (the two
 * fields Fergus stores). Normalization strips spaces, dashes, parens, and
 * prefixes UK numbers to 44 form where applicable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

// Normalise a raw phone-ish string to digits-only E.164-style (no +).
// Handles the common UK formats: 07xxx, +447xxx, 447xxx, (020) 7xxx, etc.
// Returns null if the result is too short to be a real number (<7 digits).
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D+/g, '')
  if (digits.length < 7) return null
  // UK lead-zero → 44
  if (digits.startsWith('0') && digits.length === 11) return `44${digits.slice(1)}`
  // Already international-looking
  return digits
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const pageSize = parseInt(url.searchParams.get('pageSize') ?? '100', 10)
  const maxPages = parseInt(url.searchParams.get('maxPages') ?? '40', 10)

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customers = await client.listAllCustomers({ pageSize, maxPages })

    const shaped = customers.map(c => {
      const mc = c.mainContact as
        | { firstName?: string; lastName?: string; mobile?: string; phone?: string; email?: string }
        | undefined
      const phones = new Set<string>()
      const mobile = normalizePhone(mc?.mobile)
      const phone = normalizePhone(mc?.phone)
      if (mobile) phones.add(mobile)
      if (phone) phones.add(phone)
      return {
        id: c.id,
        customerFullName: c.customerFullName,
        mainContact: mc ?? null,
        physicalAddress: c.physicalAddress ?? null,
        phones: Array.from(phones),
      }
    })

    return NextResponse.json({
      count: shaped.length,
      customers: shaped,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_list_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
