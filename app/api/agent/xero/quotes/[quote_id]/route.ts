import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

function isGuid(id: string) { return /^[a-f0-9-]{36}$/i.test(id) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ quote_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { quote_id } = await params
  if (!isGuid(quote_id)) return NextResponse.json({ error: 'invalid quote_id' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const quote = await client.getQuote(quote_id)
    if (!quote) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ quote })
  } catch (e) {
    return NextResponse.json({ error: 'xero_get_quote_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}

/** PATCH /api/agent/xero/quotes/[id] — update status (SENT | ACCEPTED | DECLINED | DRAFT) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ quote_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { quote_id } = await params
  if (!isGuid(quote_id)) return NextResponse.json({ error: 'invalid quote_id' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  if (!body.status || !['SENT', 'ACCEPTED', 'DECLINED', 'DRAFT'].includes(body.status)) {
    return NextResponse.json({ error: 'status must be SENT|ACCEPTED|DECLINED|DRAFT' }, { status: 400 })
  }
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const quote = await client.updateQuoteStatus(quote_id, body.status)
    return NextResponse.json({ quote })
  } catch (e) {
    return NextResponse.json({ error: 'xero_update_quote_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
