/**
 * POST /api/agent/xero/payments/record
 *
 * Body:
 * {
 *   invoice_id: string,
 *   amount: number,              // GBP
 *   bank_account_id: string,     // Xero AccountID of the receiving bank
 *   date?: "YYYY-MM-DD",         // default today
 *   reference?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, logAgentAction } from '@/lib/agent-auth'
import { enforceTrust, safeErrorDetail } from '@/lib/agent-trust-gate'
import { XeroClient } from '@/lib/integrations/xero'

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const { invoice_id, amount, bank_account_id, date, reference } = body
  if (!invoice_id || typeof amount !== 'number' || !bank_account_id) {
    return NextResponse.json(
      { error: 'invoice_id, amount (number), bank_account_id required' },
      { status: 400 },
    )
  }

  // Recording a payment mutates the books — requires TL3 (financial_mutation).
  const trust = enforceTrust(auth, 'financial_mutation', amount)
  if (!trust.allowed) return trust.response!

  let xero: XeroClient
  try {
    xero = await XeroClient.forClient(auth.clientId)
  } catch (e) {
    return NextResponse.json({ error: 'Xero not connected', detail: safeErrorDetail(e) }, { status: 409 })
  }

  const payDate = date ?? new Date().toISOString().split('T')[0]

  try {
    await xero.recordPayment({
      invoiceId: invoice_id,
      amount,
      date: payDate,
      bankAccountId: bank_account_id,
      reference,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Xero payment failed', detail: safeErrorDetail(e) }, { status: 502 })
  }

  await logAgentAction({
    clientId: auth.clientId,
    category: 'admin_task',
    skillUsed: 'record-xero-payment',
    summary: `Payment of £${amount} recorded against invoice ${invoice_id}`,
    outcomeTag: 'n_a',
    valueGbp: amount,
    meta: { invoice_id, bank_account_id, date: payDate, reference },
  })

  return NextResponse.json({ ok: true, invoice_id, amount, date: payDate })
}
