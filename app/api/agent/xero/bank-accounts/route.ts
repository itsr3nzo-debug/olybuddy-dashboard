/**
 * GET /api/agent/xero/bank-accounts
 *
 * Convenience wrapper — returns only Xero accounts where Type=BANK, so the agent
 * can pick a bank_account_id for /payments/record or /bills/{id}/pay without
 * scanning the full chart of accounts.
 *
 * Requires accounting.settings.read scope (Julian must reconnect Xero).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  try {
    const client = await XeroClient.forClient(auth.clientId)
    const all = await client.listAccounts()
    const banks = all.filter(a => (a as { Type?: string }).Type === 'BANK')
    return NextResponse.json({
      count: banks.length,
      bank_accounts: banks.map(a => {
        const x = a as { AccountID?: string; Code?: string; Name?: string; BankAccountNumber?: string; CurrencyCode?: string; Status?: string }
        return {
          account_id: x.AccountID,
          code: x.Code,
          name: x.Name,
          account_number: x.BankAccountNumber,
          currency: x.CurrencyCode,
          status: x.Status,
        }
      }),
    })
  } catch (e) {
    return NextResponse.json({ error: 'xero_bank_accounts_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
