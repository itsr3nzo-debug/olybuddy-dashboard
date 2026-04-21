import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

/** GET /api/agent/xero/accounts — chart of accounts. Agent needs this to pick AccountCode/bank_account_id for writes. */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const accounts = await client.listAccounts()
    return NextResponse.json({ count: accounts.length, accounts })
  } catch (e) {
    return NextResponse.json({ error: 'xero_list_accounts_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
