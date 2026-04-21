import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

/** GET /api/agent/xero/bank-transactions?account_id=&date_from= */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const url = new URL(req.url)
  const accountId = url.searchParams.get('account_id') || undefined
  const dateFrom = url.searchParams.get('date_from') || undefined
  if (accountId && !/^[a-f0-9-]{36}$/i.test(accountId)) return NextResponse.json({ error: 'invalid account_id' }, { status: 400 })
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return NextResponse.json({ error: 'invalid date_from' }, { status: 400 })
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const txns = await client.getBankTransactions({ accountId, dateFrom })
    return NextResponse.json({ count: txns.length, transactions: txns })
  } catch (e) {
    return NextResponse.json({ error: 'xero_bank_tx_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
