/**
 * Xero REST client.
 *
 * Handles OAuth token refresh, tenant (Xero org) selection, and the endpoints
 * trades businesses actually need: contacts, invoices, bills, payments,
 * bank transactions, attachments, reports.
 *
 * Design:
 *  - Per-client instance. `await XeroClient.forClient(clientId)` loads the
 *    stored token + tenant from Supabase's `integrations` table.
 *  - Access tokens expire every 30 min. Every outbound call auto-refreshes
 *    if expiry is within 2 min, using the stored refresh token.
 *  - Refresh tokens rotate every 60 days — we persist the new one after each
 *    refresh.
 *  - Rate-limit aware: 60 calls/min/org, 5,000/day/org. We surface the
 *    `X-Rate-Limit-*` headers on the result so the agent can back off.
 *
 * See docs/XERO_INTEGRATION_PLAN.md for the product-level story.
 * See docs/POST_MORTEM_JULIAN_VARLEY_ONBOARDING.md for why the credential
 * model is per-client + tenant-scoped.
 */

import { createClient } from '@supabase/supabase-js'
import { encryptToken, decryptToken } from '@/lib/encryption'

const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface XeroTenant {
  id: string // tenantId (UUID)
  tenantName: string
  tenantType: string // ORGANISATION
}

export interface XeroContact {
  ContactID: string
  Name: string
  EmailAddress?: string
  Phones?: Array<{ PhoneNumber?: string; PhoneType: string }>
  IsSubcontractor?: boolean
  UpdatedDateUTC?: string
}

export interface XeroLineItem {
  Description: string
  Quantity: number
  UnitAmount: number
  AccountCode?: string
  TaxType?: string // OUTPUT2 (20% VAT), ECOUTPUTSERVICES (reverse charge 20%), ZERORATEDOUTPUT, etc.
  ItemCode?: string
  DiscountRate?: number
}

export interface XeroInvoiceInput {
  Type: 'ACCREC' | 'ACCPAY' // ACCREC = customer invoice, ACCPAY = bill
  Contact: { ContactID: string } | { Name: string } // create-if-missing with Name
  Date: string // YYYY-MM-DD
  DueDate?: string // optional — Xero allows bills/invoices without a due date
  LineItems: XeroLineItem[]
  Reference?: string
  Status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' // DRAFT is the safe default; AUTHORISED is ready-to-send
  LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax'
  InvoiceNumber?: string
  BrandingThemeID?: string
}

export interface XeroInvoice {
  InvoiceID: string
  InvoiceNumber: string
  Type: 'ACCREC' | 'ACCPAY'
  Contact: { ContactID: string; Name?: string }
  Date: string
  DueDate: string
  LineItems: XeroLineItem[]
  Reference?: string
  Status: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED' | 'DELETED'
  AmountDue: number
  AmountPaid: number
  Total: number
  UpdatedDateUTC: string
  FullyPaidOnDate?: string
  LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax'
}

export class XeroClient {
  private clientId: string
  private tenantId: string
  private accessToken: string
  private refreshToken: string
  private tokenExpiresAt: Date
  private integrationRowId: string
  private loadedUpdatedAt: string

  private constructor(args: {
    clientId: string
    tenantId: string
    accessToken: string
    refreshToken: string
    tokenExpiresAt: Date
    integrationRowId: string
    loadedUpdatedAt: string
  }) {
    this.clientId = args.clientId
    this.tenantId = args.tenantId
    this.accessToken = args.accessToken
    this.refreshToken = args.refreshToken
    this.tokenExpiresAt = args.tokenExpiresAt
    this.integrationRowId = args.integrationRowId
    this.loadedUpdatedAt = args.loadedUpdatedAt
  }

  /** Load + construct a client from the stored integration row. */
  static async forClient(clientUuid: string): Promise<XeroClient> {
    const supabase = svc()
    const { data, error } = await supabase
      .from('integrations')
      .select('id, access_token_enc, refresh_token_enc, token_expires_at, metadata, status, updated_at')
      .eq('client_id', clientUuid)
      .eq('provider', 'xero')
      .eq('status', 'connected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      throw new Error(`No active Xero integration for client ${clientUuid}: ${error?.message ?? 'not connected'}`)
    }
    // Callback stores as camelCase `tenantId`. Older rows may have snake_case — handle both.
    const md = data.metadata as { tenantId?: string; tenant_id?: string; tenants?: XeroTenant[] } | null
    const tenantId = md?.tenantId ?? md?.tenant_id
    if (!tenantId) {
      throw new Error(`Xero integration for ${clientUuid} missing tenantId in metadata — reconnect may be required`)
    }

    return new XeroClient({
      clientId: clientUuid,
      tenantId,
      accessToken: decryptToken(data.access_token_enc!),
      refreshToken: decryptToken(data.refresh_token_enc!),
      tokenExpiresAt: new Date(data.token_expires_at!),
      integrationRowId: data.id,
      loadedUpdatedAt: data.updated_at!,
    })
  }

  /** Check if token expires in <2 min. */
  private needsRefresh(): boolean {
    return this.tokenExpiresAt.getTime() - Date.now() < 2 * 60 * 1000
  }

  /**
   * Refresh tokens; persist rotated refresh_token back to Supabase.
   *
   * Race-safe: we use optimistic concurrency — the UPDATE requires the current
   * encrypted refresh-token to match what we loaded. If two concurrent requests
   * both try to refresh, only one wins; the loser re-reads the DB row and uses
   * the newly-persisted token. (Xero rotates refresh tokens; the loser's old
   * refresh token would otherwise be invalidated.)
   */
  private async refreshIfNeeded(): Promise<void> {
    if (!this.needsRefresh()) return

    // Snapshot the updated_at we loaded with — used for optimistic-lock on write.
    // (Previous version compared encrypted refresh tokens, but encryptToken uses a
    // random IV so the ciphertext changes every call, meaning the .eq() NEVER
    // matched and rotations were silently dropped, leaving stale tokens forever.)
    const loadedUpdatedAt = this.loadedUpdatedAt

    const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    })
    const res = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      // Another worker may have just rotated our token. Re-read the row and
      // try with whatever fresh refresh_token lives in the DB now.
      const { data: fresh } = await svc()
        .from('integrations')
        .select('access_token_enc, refresh_token_enc, token_expires_at, updated_at')
        .eq('id', this.integrationRowId)
        .maybeSingle()
      if (fresh && fresh.updated_at !== loadedUpdatedAt) {
        this.accessToken = decryptToken(fresh.access_token_enc!)
        this.refreshToken = decryptToken(fresh.refresh_token_enc!)
        this.tokenExpiresAt = new Date(fresh.token_expires_at!)
        this.loadedUpdatedAt = fresh.updated_at!
        if (!this.needsRefresh()) return
      }
      const txt = await res.text().catch(() => '')
      throw new Error(`Xero refresh failed ${res.status}: ${txt.slice(0, 200)}`)
    }
    const j: { access_token: string; refresh_token: string; expires_in: number } = await res.json()

    const newUpdatedAt = new Date().toISOString()
    // Optimistic concurrency via updated_at: only write if the row's updated_at
    // still equals what we loaded. If another worker got there first, their
    // rotation wins and we re-read + use their tokens.
    const updateRes = await svc()
      .from('integrations')
      .update({
        access_token_enc: encryptToken(j.access_token),
        refresh_token_enc: encryptToken(j.refresh_token),
        token_expires_at: new Date(Date.now() + j.expires_in * 1000).toISOString(),
        updated_at: newUpdatedAt,
      })
      .eq('id', this.integrationRowId)
      .eq('updated_at', loadedUpdatedAt)
      .select('id')

    if (updateRes.data && updateRes.data.length > 0) {
      // We wrote first — use our rotated token.
      this.accessToken = j.access_token
      this.refreshToken = j.refresh_token
      this.tokenExpiresAt = new Date(Date.now() + j.expires_in * 1000)
      this.loadedUpdatedAt = newUpdatedAt
    } else {
      // Lost the race. Reload whatever the winner persisted.
      const { data: fresh } = await svc()
        .from('integrations')
        .select('access_token_enc, refresh_token_enc, token_expires_at, updated_at')
        .eq('id', this.integrationRowId)
        .maybeSingle()
      if (fresh) {
        this.accessToken = decryptToken(fresh.access_token_enc!)
        this.refreshToken = decryptToken(fresh.refresh_token_enc!)
        this.tokenExpiresAt = new Date(fresh.token_expires_at!)
        this.loadedUpdatedAt = fresh.updated_at!
      }
    }
  }

  /** Core request wrapper. */
  private async req<T = unknown>(method: string, path: string, body?: unknown): Promise<{ data: T; rateLimit: { minute: number; day: number } | null }> {
    await this.refreshIfNeeded()
    const res = await fetch(`${XERO_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'xero-tenant-id': this.tenantId,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const rateLimit = (() => {
      const minute = Number(res.headers.get('X-MinLimit-Remaining') ?? -1)
      const day = Number(res.headers.get('X-DayLimit-Remaining') ?? -1)
      if (minute < 0 && day < 0) return null
      return { minute, day }
    })()

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Xero ${method} ${path} failed ${res.status}: ${txt.slice(0, 400)}`)
    }
    if (res.status === 204) return { data: null as T, rateLimit }
    const data = (await res.json()) as T
    return { data, rateLimit }
  }

  // ─── Reads ──────────────────────────────────────────────

  async listContacts(search?: string): Promise<XeroContact[]> {
    const q = search ? `?where=${encodeURIComponent(`Name.Contains("${search.replace(/"/g, '\\"')}")`)}` : ''
    const { data } = await this.req<{ Contacts: XeroContact[] }>('GET', `/Contacts${q}`)
    return data?.Contacts ?? []
  }

  async getContact(contactId: string): Promise<XeroContact | null> {
    const { data } = await this.req<{ Contacts: XeroContact[] }>('GET', `/Contacts/${contactId}`)
    return data?.Contacts?.[0] ?? null
  }

  async listInvoices(filter?: { status?: string; dateFrom?: string; contactId?: string }): Promise<XeroInvoice[]> {
    const clauses: string[] = []
    if (filter?.status) clauses.push(`Status=="${filter.status}"`)
    if (filter?.dateFrom) clauses.push(`Date>=DateTime(${filter.dateFrom.replace(/-/g, ',')})`)
    if (filter?.contactId) clauses.push(`Contact.ContactID=Guid("${filter.contactId}")`)
    const where = clauses.length ? `?where=${encodeURIComponent(clauses.join('&&'))}` : ''
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('GET', `/Invoices${where}`)
    return data?.Invoices ?? []
  }

  async listOverdueInvoices(): Promise<XeroInvoice[]> {
    // Paginate Xero's 100-per-page limit. Use server-side DueDate filter to
    // only pull invoices that could be overdue. Limit to last 365 days to
    // prevent an unbounded pull on a client with 5yr history.
    const today = new Date().toISOString().split('T')[0]
    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().split('T')[0]
    const all: XeroInvoice[] = []
    for (let page = 1; page <= 50; page++) {
      const where = encodeURIComponent(`Type=="ACCREC"&&Status=="AUTHORISED"&&DueDate<DateTime(${today.split('-').map(Number).join(',')})&&Date>=DateTime(${yearAgo.split('-').map(Number).join(',')})`)
      const { data } = await this.req<{ Invoices: XeroInvoice[] }>('GET', `/Invoices?where=${where}&page=${page}&order=DueDate`)
      const rows = data?.Invoices ?? []
      all.push(...rows.filter(i => (i.AmountDue ?? 0) > 0))
      if (rows.length < 100) break
    }
    return all
  }

  async getInvoicePDF(invoiceId: string): Promise<ArrayBuffer> {
    await this.refreshIfNeeded()
    const res = await fetch(`${XERO_API_BASE}/Invoices/${invoiceId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'xero-tenant-id': this.tenantId,
        Accept: 'application/pdf',
      },
    })
    if (!res.ok) throw new Error(`Xero invoice PDF fetch failed ${res.status}`)
    return res.arrayBuffer()
  }

  /**
   * List supplier BILLS (ACCPAY invoices). This is how we surface Dext data
   * without connecting to Dext directly — Dext syncs every captured receipt
   * into Xero as a Bill, so reading Bills from Xero = reading Dext.
   */
  async listBills(filter?: { status?: string; dateFrom?: string; dateTo?: string; pageSize?: number }): Promise<XeroInvoice[]> {
    // Paginated, 100 per page (Xero max), filtered server-side.
    const clauses = ['Type=="ACCPAY"']
    if (filter?.status) clauses.push(`Status=="${filter.status}"`)
    if (filter?.dateFrom) clauses.push(`Date>=DateTime(${filter.dateFrom.split('-').map(Number).join(',')})`)
    if (filter?.dateTo) clauses.push(`Date<=DateTime(${filter.dateTo.split('-').map(Number).join(',')})`)
    const baseWhere = encodeURIComponent(clauses.join('&&'))
    const all: XeroInvoice[] = []
    const maxPages = 20 // 2000 bills max per call — sensible cap
    for (let page = 1; page <= maxPages; page++) {
      const { data } = await this.req<{ Invoices: XeroInvoice[] }>('GET', `/Invoices?where=${baseWhere}&page=${page}&order=Date DESC`)
      const rows = data?.Invoices ?? []
      all.push(...rows)
      if (rows.length < 100) break
    }
    return all
  }

  /** Total supplier spend in the given date window, split by supplier. */
  async supplierSpendSummary(args: { dateFrom: string; dateTo?: string }): Promise<Array<{ supplier: string; total_gbp: number; bill_count: number }>> {
    const bills = await this.listBills({ dateFrom: args.dateFrom, dateTo: args.dateTo })
    const bySupplier = new Map<string, { total: number; count: number }>()
    for (const b of bills) {
      const name = (b.Contact as { Name?: string })?.Name ?? 'Unknown supplier'
      const existing = bySupplier.get(name) ?? { total: 0, count: 0 }
      existing.total += b.Total ?? 0
      existing.count += 1
      bySupplier.set(name, existing)
    }
    return Array.from(bySupplier.entries())
      .map(([supplier, v]) => ({ supplier, total_gbp: Math.round(v.total * 100) / 100, bill_count: v.count }))
      .sort((a, b) => b.total_gbp - a.total_gbp)
  }

  async getBankTransactions(filter?: { accountId?: string; dateFrom?: string }): Promise<unknown[]> {
    const clauses: string[] = []
    if (filter?.accountId) clauses.push(`BankAccount.AccountID=Guid("${filter.accountId}")`)
    if (filter?.dateFrom) clauses.push(`Date>=DateTime(${filter.dateFrom.replace(/-/g, ',')})`)
    const where = clauses.length ? `?where=${encodeURIComponent(clauses.join('&&'))}` : ''
    const { data } = await this.req<{ BankTransactions: unknown[] }>('GET', `/BankTransactions${where}`)
    return data?.BankTransactions ?? []
  }

  // ─── Writes ─────────────────────────────────────────────

  async createContact(contact: {
    Name: string
    EmailAddress?: string
    Phone?: string
    IsSubcontractor?: boolean
  }): Promise<XeroContact> {
    const payload = {
      Contacts: [
        {
          Name: contact.Name,
          ...(contact.EmailAddress && { EmailAddress: contact.EmailAddress }),
          ...(contact.Phone && { Phones: [{ PhoneType: 'MOBILE', PhoneNumber: contact.Phone }] }),
          ...(contact.IsSubcontractor !== undefined && { IsSubcontractor: contact.IsSubcontractor }),
        },
      ],
    }
    const { data } = await this.req<{ Contacts: XeroContact[] }>('POST', '/Contacts', payload)
    if (!data?.Contacts?.[0]) throw new Error('Xero createContact returned no contact')
    return data.Contacts[0]
  }

  /**
   * Create invoice. Always DRAFT by default — agent creates drafts, owner approves via dashboard
   * or the trust-routing gate before moving to AUTHORISED (which is what actually sends/emails).
   */
  async createInvoice(input: XeroInvoiceInput): Promise<XeroInvoice> {
    const body = {
      Invoices: [
        {
          ...input,
          Status: input.Status ?? 'DRAFT',
          LineAmountTypes: input.LineAmountTypes ?? 'Exclusive',
        },
      ],
    }
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', '/Invoices', body)
    if (!data?.Invoices?.[0]) throw new Error('Xero createInvoice returned no invoice')
    return data.Invoices[0]
  }

  /** Move a DRAFT invoice to AUTHORISED (i.e. send it). */
  async authoriseInvoice(invoiceId: string): Promise<XeroInvoice> {
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', `/Invoices/${invoiceId}`, {
      Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }],
    })
    return data.Invoices[0]
  }

  async emailInvoice(invoiceId: string): Promise<void> {
    await this.req('POST', `/Invoices/${invoiceId}/Email`, {})
  }

  async recordPayment(args: {
    invoiceId: string
    amount: number
    date: string // YYYY-MM-DD
    bankAccountId: string // the Xero AccountID of the receiving bank account
    reference?: string
  }): Promise<void> {
    const body = {
      Payments: [
        {
          Invoice: { InvoiceID: args.invoiceId },
          Account: { AccountID: args.bankAccountId },
          Amount: args.amount,
          Date: args.date,
          ...(args.reference && { Reference: args.reference }),
        },
      ],
    }
    await this.req('POST', '/Payments', body)
  }

  async uploadAttachment(invoiceId: string, fileName: string, content: Buffer, mimeType: string): Promise<void> {
    await this.refreshIfNeeded()
    const res = await fetch(`${XERO_API_BASE}/Invoices/${invoiceId}/Attachments/${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'xero-tenant-id': this.tenantId,
        'Content-Type': mimeType,
        Accept: 'application/json',
      },
      body: new Uint8Array(content), // fetch expects BodyInit, not Node Buffer — Uint8Array is compatible
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Xero uploadAttachment failed ${res.status}: ${txt.slice(0, 300)}`)
    }
  }

  // ─── Additional reads ────────────────────────────────────

  async getInvoice(invoiceId: string): Promise<XeroInvoice | null> {
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('GET', `/Invoices/${invoiceId}`)
    return data?.Invoices?.[0] ?? null
  }

  async getQuote(quoteId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.req<{ Quotes: Array<Record<string, unknown>> }>('GET', `/Quotes/${quoteId}`)
    return data?.Quotes?.[0] ?? null
  }

  async listQuotes(filter?: { status?: string; contactId?: string; dateFrom?: string }): Promise<Array<Record<string, unknown>>> {
    const clauses: string[] = []
    if (filter?.status) clauses.push(`Status=="${filter.status}"`)
    if (filter?.contactId) clauses.push(`Contact.ContactID=Guid("${filter.contactId}")`)
    if (filter?.dateFrom) clauses.push(`Date>=DateTime(${filter.dateFrom.replace(/-/g, ',')})`)
    const where = clauses.length ? `?where=${encodeURIComponent(clauses.join('&&'))}` : ''
    const { data } = await this.req<{ Quotes: Array<Record<string, unknown>> }>('GET', `/Quotes${where}`)
    return data?.Quotes ?? []
  }

  async listItems(): Promise<Array<Record<string, unknown>>> {
    const { data } = await this.req<{ Items: Array<Record<string, unknown>> }>('GET', '/Items')
    return data?.Items ?? []
  }

  async listAccounts(): Promise<Array<Record<string, unknown>>> {
    const { data } = await this.req<{ Accounts: Array<Record<string, unknown>> }>('GET', '/Accounts')
    return data?.Accounts ?? []
  }

  async getAgedReceivables(contactId?: string): Promise<Record<string, unknown> | null> {
    const path = contactId
      ? `/Reports/AgedReceivablesByContact?contactId=${contactId}`
      : '/Reports/AgedReceivablesByContact'
    const { data } = await this.req<{ Reports: Array<Record<string, unknown>> }>('GET', path)
    return data?.Reports?.[0] ?? null
  }

  async getProfitLoss(args?: { fromDate?: string; toDate?: string }): Promise<Record<string, unknown> | null> {
    const qs = new URLSearchParams()
    if (args?.fromDate) qs.set('fromDate', args.fromDate)
    if (args?.toDate) qs.set('toDate', args.toDate)
    const path = `/Reports/ProfitAndLoss${qs.toString() ? '?' + qs.toString() : ''}`
    const { data } = await this.req<{ Reports: Array<Record<string, unknown>> }>('GET', path)
    return data?.Reports?.[0] ?? null
  }

  async getVatReturn(args?: { fromDate?: string; toDate?: string }): Promise<Record<string, unknown> | null> {
    // Xero returns VAT via /Reports/TaxReturn or org-specific HMRC MTD submissions; this reads the standard report.
    const qs = new URLSearchParams()
    if (args?.fromDate) qs.set('fromDate', args.fromDate)
    if (args?.toDate) qs.set('toDate', args.toDate)
    const path = `/Reports/TaxReturn${qs.toString() ? '?' + qs.toString() : ''}`
    const { data } = await this.req<{ Reports: Array<Record<string, unknown>> }>('GET', path)
    return data?.Reports?.[0] ?? null
  }

  // ─── Additional writes ───────────────────────────────────

  async updateInvoice(invoiceId: string, patch: Partial<XeroInvoiceInput> & { Status?: string }): Promise<XeroInvoice | null> {
    const body = { Invoices: [{ InvoiceID: invoiceId, ...patch }] }
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', `/Invoices/${invoiceId}`, body)
    return data?.Invoices?.[0] ?? null
  }

  /**
   * Void or delete an invoice depending on its current status.
   * Xero rules:
   *   DRAFT       → can only be set to DELETED
   *   SUBMITTED   → can only be set to DELETED
   *   AUTHORISED  → can be set to VOIDED (only if no payments applied)
   *   PAID/VOIDED → terminal, cannot change
   * We look up current status first and pick the right terminal.
   */
  async voidInvoice(invoiceId: string): Promise<XeroInvoice | null> {
    const current = await this.getInvoice(invoiceId)
    if (!current) throw new Error(`Invoice ${invoiceId} not found`)
    const terminal =
      current.Status === 'DRAFT' || current.Status === 'SUBMITTED' ? 'DELETED' : 'VOIDED'
    if (current.Status === 'VOIDED' || current.Status === 'PAID') {
      // Already terminal — return as-is.
      return current
    }
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', `/Invoices/${invoiceId}`, {
      Invoices: [{ InvoiceID: invoiceId, Status: terminal }],
    })
    return data?.Invoices?.[0] ?? null
  }

  async updateContact(contactId: string, patch: {
    Name?: string
    EmailAddress?: string
    Phone?: string
    IsSubcontractor?: boolean
  }): Promise<XeroContact | null> {
    const body: Record<string, unknown> = { ContactID: contactId }
    if (patch.Name) body.Name = patch.Name
    if (patch.EmailAddress) body.EmailAddress = patch.EmailAddress
    if (patch.Phone) body.Phones = [{ PhoneType: 'MOBILE', PhoneNumber: patch.Phone }]
    if (patch.IsSubcontractor !== undefined) body.IsSubcontractor = patch.IsSubcontractor
    const { data } = await this.req<{ Contacts: XeroContact[] }>('POST', `/Contacts/${contactId}`, {
      Contacts: [body],
    })
    return data?.Contacts?.[0] ?? null
  }

  async createQuote(input: {
    Contact: { ContactID: string }
    Date: string
    ExpiryDate?: string
    Title?: string
    Summary?: string
    LineItems: Array<{
      Description: string
      Quantity: number
      UnitAmount: number
      AccountCode?: string
      TaxType?: string
    }>
    Status?: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED'
  }): Promise<Record<string, unknown> | null> {
    const body = { Quotes: [{ ...input, Status: input.Status ?? 'DRAFT' }] }
    const { data } = await this.req<{ Quotes: Array<Record<string, unknown>> }>('POST', '/Quotes', body)
    return data?.Quotes?.[0] ?? null
  }

  async updateQuoteStatus(quoteId: string, status: 'SENT' | 'ACCEPTED' | 'DECLINED' | 'DRAFT'): Promise<Record<string, unknown> | null> {
    // Xero Quotes update requires the full quote body, not just {QuoteID, Status} —
    // unlike Invoices, Quote PATCH-style updates throw ValidationException.
    // Fetch the current quote, overlay the new status, POST back.
    const current = await this.getQuote(quoteId)
    if (!current) throw new Error(`Quote ${quoteId} not found`)
    const payload = { ...current, Status: status }
    const { data } = await this.req<{ Quotes: Array<Record<string, unknown>> }>(
      'POST',
      `/Quotes/${quoteId}`,
      { Quotes: [payload] },
    )
    return data?.Quotes?.[0] ?? null
  }

  async createBill(input: XeroInvoiceInput): Promise<XeroInvoice | null> {
    // ACCPAY = supplier bill (money out). Same shape as invoice, different Type.
    const body = { Invoices: [{ ...input, Type: 'ACCPAY', Status: input.Status ?? 'DRAFT' }] }
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', '/Invoices', body)
    return data?.Invoices?.[0] ?? null
  }

  async approveBill(billId: string): Promise<XeroInvoice | null> {
    const { data } = await this.req<{ Invoices: XeroInvoice[] }>('POST', `/Invoices/${billId}`, {
      Invoices: [{ InvoiceID: billId, Status: 'AUTHORISED' }],
    })
    return data?.Invoices?.[0] ?? null
  }

  async payBill(args: {
    billId: string
    amount: number
    date: string // YYYY-MM-DD
    bankAccountId: string
    reference?: string
  }): Promise<void> {
    // Same shape as recordPayment but against an ACCPAY invoice.
    const body = {
      Payments: [
        {
          Invoice: { InvoiceID: args.billId },
          Account: { AccountID: args.bankAccountId },
          Amount: args.amount,
          Date: args.date,
          ...(args.reference && { Reference: args.reference }),
        },
      ],
    }
    await this.req('POST', '/Payments', body)
  }

  async createCreditNote(input: {
    Type: 'ACCRECCREDIT' | 'ACCPAYCREDIT' // receivable (to customer) vs payable (from supplier)
    Contact: { ContactID: string }
    Date: string
    LineItems: Array<{ Description: string; Quantity: number; UnitAmount: number; AccountCode?: string; TaxType?: string }>
    Reference?: string
    Status?: 'DRAFT' | 'AUTHORISED'
  }): Promise<Record<string, unknown> | null> {
    const body = { CreditNotes: [{ ...input, Status: input.Status ?? 'DRAFT' }] }
    const { data } = await this.req<{ CreditNotes: Array<Record<string, unknown>> }>('POST', '/CreditNotes', body)
    return data?.CreditNotes?.[0] ?? null
  }

  async createItem(input: {
    Code: string
    Name: string
    Description?: string
    UnitPrice?: number
    AccountCode?: string
    TaxType?: string
    IsSold?: boolean
    IsPurchased?: boolean
  }): Promise<Record<string, unknown> | null> {
    const sale: Record<string, unknown> = {}
    if (input.UnitPrice != null) sale.UnitPrice = input.UnitPrice
    if (input.AccountCode) sale.AccountCode = input.AccountCode
    if (input.TaxType) sale.TaxType = input.TaxType
    const body = {
      Items: [
        {
          Code: input.Code,
          Name: input.Name,
          ...(input.Description && { Description: input.Description }),
          ...(input.IsSold != null && { IsSold: input.IsSold }),
          ...(input.IsPurchased != null && { IsPurchased: input.IsPurchased }),
          ...(Object.keys(sale).length && { SalesDetails: sale }),
        },
      ],
    }
    const { data } = await this.req<{ Items: Array<Record<string, unknown>> }>('PUT', '/Items', body)
    return data?.Items?.[0] ?? null
  }

  // ─── UK trades helpers ───────────────────────────────────

  /**
   * UK VAT tax codes for trades invoices.
   *
   * HMRC LIABILITY NOTE (2026-04-18 — the reason we DO NOT auto-apply DRC):
   *
   * Domestic Reverse Charge (DRC, `ECOUTPUTSERVICES`) applies only when ALL of:
   *   1. Both parties are VAT-registered
   *   2. Services fall within the Construction Industry Scheme (CIS)
   *   3. Customer is NOT an "end-user" or "intermediary supplier"
   *   4. Neither party is connected (same group)
   *
   * Misclassifying reverse charge is an HMRC compliance issue where liability
   * sits with the supplier (the agent's owner). We refuse to auto-apply DRC
   * from heuristics or from a `reverseChargeEligible` flag set by the agent —
   * that decision must come from the owner (or their accountant), per invoice.
   *
   * CIS (Construction Industry Scheme) is a PAYE income-tax deduction at the
   * labour line, NOT a VAT treatment. Do not confuse the two. CIS is set at
   * the Xero org level by the accountant; we do not touch it here.
   *
   * Behaviour:
   *  - If a line has an explicit `TaxType` → respect it (owner-set).
   *  - If no `TaxType` → default to `OUTPUT2` (standard UK 20% VAT).
   *  - DRC (`ECOUTPUTSERVICES`) is NEVER auto-applied. To ship a DRC invoice,
   *    the owner must explicitly set `TaxType: 'ECOUTPUTSERVICES'` on the
   *    relevant line items when approving the draft.
   */
  static applyUkTaxCodes(lines: XeroLineItem[]): XeroLineItem[] {
    return lines.map(l => {
      if (l.TaxType) return l // respect explicit owner override (including DRC)
      return { ...l, TaxType: 'OUTPUT2' } // UK 20% standard — the only auto-applied code
    })
  }

  // ─── Static helpers for the OAuth callback ───────────────

  /** Exchange the auth code at the callback. Called once, at connect time. */
  static async exchangeCodeForTokens(args: {
    code: string
    redirectUri: string
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; idToken: string }> {
    const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
    })
    const res = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Xero code exchange failed ${res.status}: ${txt.slice(0, 300)}`)
    }
    const j: { access_token: string; refresh_token: string; expires_in: number; id_token: string } = await res.json()
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresIn: j.expires_in,
      idToken: j.id_token,
    }
  }

  /** Fetch the list of tenants (Xero orgs) the user has authorised us to access. */
  static async listTenants(accessToken: string): Promise<XeroTenant[]> {
    const res = await fetch(XERO_CONNECTIONS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Xero tenant list failed ${res.status}: ${txt.slice(0, 300)}`)
    }
    return res.json() as Promise<XeroTenant[]>
  }
}
