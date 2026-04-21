import { NextResponse } from 'next/server'

/**
 * POST /api/agent/fergus/jobs/<id>/invoice — NOT SUPPORTED.
 *
 * The Fergus Partner API does not expose an invoicing write endpoint.
 * Verified against https://api.fergus.com/docs/json — only `GET /customerInvoices`
 * and `GET /customerInvoices/{invoiceId}` exist. Invoice generation happens
 * inside the Fergus UI and (if connected) auto-syncs to Xero.
 *
 * If the goal is Xero invoicing directly, use `POST /api/agent/xero/invoices/create`.
 */
export async function POST() {
  return NextResponse.json({
    error: 'not_supported',
    reason: 'Fergus Partner API has no POST endpoint for invoicing. Generate the invoice inside the Fergus UI; if Xero is connected it syncs automatically.',
    fergus_endpoint_checked: 'api.fergus.com/docs/json — only GET /customerInvoices exists',
    alternative: 'POST /api/agent/xero/invoices/create — creates the invoice directly in Xero.',
  }, { status: 501 })
}
