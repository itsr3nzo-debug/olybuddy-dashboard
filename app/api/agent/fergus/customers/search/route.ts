/**
 * GET /api/agent/fergus/customers/search?q=<query>
 *
 * Agent reads from Fergus — search customers by name/email/phone. Used before
 * creating a job so the agent can match to an existing customer instead of
 * creating duplicates.
 *
 * Returns: { count, customers: [{ id, customerFullName, mainContact, physicalAddress }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const q = new URL(req.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'q query param (min 2 chars) required' }, { status: 400 })
  }

  try {
    const client = await FergusClient.forClient(auth.clientId)
    const customers = await client.searchCustomers(q)
    return NextResponse.json({
      count: customers.length,
      customers: customers.map(c => ({
        id: c.id,
        customerFullName: c.customerFullName,
        mainContact: c.mainContact ?? null,
        physicalAddress: c.physicalAddress ?? null,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_search_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
