/**
 * Fergus REST client.
 *
 * Schema verified against Fergus Ltd's OWN open-source MCP at
 * https://github.com/Jayco-Design/fergus-mcp (Jayco-Design is Fergus Ltd's
 * GitHub org). We match their endpoint paths + body shapes exactly.
 *
 * Base URL:       https://api.fergus.com  (no /api/v1 prefix)
 * Authentication: Authorization: Bearer <PAT>   (or OAuth 2.0)
 * Key endpoints:
 *   POST /customers          → create customer ({customerFullName, mainContact, physicalAddress?})
 *   POST /jobs               → create job ({jobType, title, isDraft: true, description?, customerId?, siteId?})
 *   PUT  /jobs/{id}/finalise → convert draft job to active
 *   GET  /jobs?filterJobNo=  → search jobs
 *   GET  /customers?…        → search customers
 *
 * Draft-first pattern: every new job is created with isDraft=true so Julian
 * can review in Fergus before it goes live. This dovetails perfectly with our
 * trust-routing gate (draft_write action class).
 */

import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/encryption'

const FERGUS_BASE = 'https://api.fergus.com'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Canonical Fergus job types (trade-specific). These match what Fergus uses in
 * their UI. If the user's Fergus account is configured with custom types, use
 * `listJobTypes()` (future) to fetch theirs.
 */
/**
 * Fergus Partner API accepts ONLY these three jobType enum values on create/update.
 * "Service Call" / "Install" / etc. are UI-side labels but are rejected by the Partner API.
 */
export type FergusJobType = 'Quote' | 'Estimate' | 'Charge Up'

/**
 * Fergus Partner API address shape. Field names are `address1/address2` (NOT
 * `addressLine1/addressLine2` — that's the UI name). `addressCountry` is picky —
 * the Partner API validates the format so we leave it off unless given.
 */
export interface FergusAddress {
  address1?: string
  address2?: string
  addressSuburb?: string
  addressCity?: string
  addressRegion?: string
  addressPostcode?: string
  addressCountry?: string
}

export interface FergusContact {
  firstName?: string
  lastName?: string
  email?: string
  mobile?: string
  phone?: string
}

export interface FergusCustomer {
  id: number
  customerFullName: string
  mainContact?: FergusContact
  physicalAddress?: FergusAddress
}

export interface FergusJob {
  id: number
  jobNo?: string
  internal_job_id?: string
  status?: string
  jobType?: string
  title?: string
  description?: string
  isDraft?: boolean
  customerId?: number
  siteId?: number
}

export class FergusClient {
  private token: string

  private constructor(token: string) {
    this.token = token
  }

  static async forClient(clientUuid: string): Promise<FergusClient> {
    const supabase = svc()
    const { data, error } = await supabase
      .from('integrations')
      .select('access_token_enc, status, updated_at')
      .eq('client_id', clientUuid)
      .eq('provider', 'fergus')
      .eq('status', 'connected')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      throw new Error(`No active Fergus integration for client ${clientUuid}`)
    }
    return new FergusClient(decryptToken(data.access_token_enc!))
  }

  private async req<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${FERGUS_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Fergus ${method} ${path} failed ${res.status}: ${txt.slice(0, 500)}`)
    }
    if (res.status === 204) return null as T
    return (await res.json()) as T
  }

  // ─── Customers ─────────────────────────────────────────
  /**
   * Search customers by name/email/phone.
   * Fergus Partner API uses `filterSearchText` (full-text) + `pageCursor` for pagination.
   * Other search params (search, q, filter, filter[name]) are SILENTLY IGNORED — they
   * return the unfiltered first page which looks like a working API but isn't.
   */
  async searchCustomers(q: string): Promise<FergusCustomer[]> {
    const params = new URLSearchParams({
      pageSize: '10',
      sortField: 'createdAt',
      sortOrder: 'desc',
      pageCursor: '0',
      filterSearchText: q,
    })
    const res = await this.req<{ data: FergusCustomer[] }>('GET', `/customers?${params.toString()}`)
    return res?.data ?? []
  }

  async createCustomer(args: { customerFullName: string; mainContact: FergusContact; physicalAddress?: FergusAddress; postalAddress?: FergusAddress }): Promise<FergusCustomer> {
    const body: Record<string, unknown> = {
      customerFullName: args.customerFullName,
      mainContact: args.mainContact,
    }
    if (args.physicalAddress) body.physicalAddress = args.physicalAddress
    if (args.postalAddress) body.postalAddress = args.postalAddress
    const res = await this.req<{ data: FergusCustomer } | FergusCustomer>('POST', '/customers', body)
    // Fergus may return `{ data: {...} }` or the object directly — handle both.
    return (res as { data: FergusCustomer })?.data ?? (res as FergusCustomer)
  }

  // ─── Jobs ──────────────────────────────────────────────
  async createJob(args: {
    jobType: FergusJobType
    title: string
    description?: string
    customerId?: number
    siteId?: number
    customerReference?: string
    isDraft?: boolean
  }): Promise<FergusJob> {
    const body: Record<string, unknown> = {
      jobType: args.jobType,
      title: args.title,
      isDraft: args.isDraft ?? true,
    }
    if (args.description) body.description = args.description
    if (args.customerId) body.customerId = args.customerId
    if (args.siteId) body.siteId = args.siteId
    if (args.customerReference) body.customerReference = args.customerReference

    const res = await this.req<{ data: FergusJob } | FergusJob>('POST', '/jobs', body)
    return (res as { data: FergusJob })?.data ?? (res as FergusJob)
  }

  /** Convert a DRAFT job to an active (non-draft) job. */
  async finaliseJob(jobId: number): Promise<FergusJob> {
    const res = await this.req<{ data: FergusJob } | FergusJob>('PUT', `/jobs/${jobId}/finalise`, {})
    return (res as { data: FergusJob })?.data ?? (res as FergusJob)
  }

  async getJob(jobId: number): Promise<FergusJob | null> {
    try {
      const res = await this.req<{ data: FergusJob } | FergusJob>('GET', `/jobs/${jobId}`)
      return (res as { data: FergusJob })?.data ?? (res as FergusJob) ?? null
    } catch {
      return null
    }
  }

  async searchJobsByNo(jobNo: string): Promise<FergusJob[]> {
    const params = new URLSearchParams({ pageSize: '10', pageCursor: '0', filterJobNo: jobNo })
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?${params.toString()}`)
    return res?.data ?? []
  }

  /** Full-text search across description/customer/site/contact/job# via filterSearchText. */
  async searchJobs(q: string, pageSize = 25): Promise<FergusJob[]> {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      pageCursor: '0',
      sortField: 'createdAt',
      sortOrder: 'desc',
      filterSearchText: q,
    })
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?${params.toString()}`)
    return res?.data ?? []
  }

  async listOpenJobs(pageSize = 25): Promise<FergusJob[]> {
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      pageCursor: '0',
      sortField: 'createdAt',
      sortOrder: 'desc',
      // Server-side filter is preferred over client-side post-filter
      filterJobStatus: 'Active',
    })
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?${params.toString()}`)
    return (res?.data ?? []).filter(j => !j.isDraft)
  }

  // ─── Additional reads ─────────────────────────────────────

  async getCustomer(customerId: number): Promise<FergusCustomer | null> {
    try {
      const res = await this.req<{ data: FergusCustomer } | FergusCustomer>('GET', `/customers/${customerId}`)
      return (res as { data: FergusCustomer })?.data ?? (res as FergusCustomer) ?? null
    } catch {
      return null
    }
  }

  async listSites(customerId?: number): Promise<Array<Record<string, unknown>>> {
    const path = customerId ? `/sites?customerId=${customerId}&pageSize=50` : '/sites?pageSize=50'
    const res = await this.req<{ data: Array<Record<string, unknown>> }>('GET', path)
    return res?.data ?? []
  }

  async listUsers(): Promise<Array<Record<string, unknown>>> {
    const res = await this.req<{ data: Array<Record<string, unknown>> }>('GET', '/users')
    return res?.data ?? []
  }

  // ─── Additional writes ────────────────────────────────────

  /**
   * Update a Fergus customer. Fergus rejects partial updates — `customerFullName`
   * AND `mainContact` MUST both be present in every PUT body. We fetch the current
   * record and overlay the patch to ensure both are sent.
   */
  async updateCustomer(customerId: number, patch: Partial<{
    customerFullName: string
    mainContact: FergusContact
    physicalAddress: FergusAddress
    postalAddress: FergusAddress
  }>): Promise<FergusCustomer | null> {
    const current = await this.getCustomer(customerId)
    if (!current) throw new Error(`Fergus customer ${customerId} not found`)
    const body: Record<string, unknown> = {
      customerFullName: patch.customerFullName ?? current.customerFullName,
      mainContact: patch.mainContact ?? current.mainContact ?? { firstName: 'Customer' },
    }
    if (patch.physicalAddress !== undefined) body.physicalAddress = patch.physicalAddress
    if (patch.postalAddress !== undefined) body.postalAddress = patch.postalAddress
    const res = await this.req<{ data: FergusCustomer } | FergusCustomer>('PUT', `/customers/${customerId}`, body)
    return (res as { data: FergusCustomer })?.data ?? (res as FergusCustomer) ?? null
  }

  /**
   * Update a Fergus job. Fergus rejects partial updates — the PUT body MUST include
   * `title` + `jobType` even if unchanged. On GET responses the title often comes back
   * as `description` instead (read/write model mismatch), so fall back to that.
   */
  async updateJob(jobId: number, patch: Partial<{
    title: string
    description: string
    status: string
    jobType: FergusJobType
    customerId: number
    siteId: number
  }>): Promise<FergusJob | null> {
    const current = await this.getJob(jobId)
    if (!current) throw new Error(`Fergus job ${jobId} not found`)
    const body: Record<string, unknown> = {
      // title + jobType are REQUIRED on every PUT
      title: patch.title ?? current.title ?? current.description ?? 'Untitled',
      jobType: (patch.jobType ?? current.jobType ?? 'Quote') as FergusJobType,
    }
    if (patch.description !== undefined) body.description = patch.description
    if (patch.status !== undefined) body.status = patch.status
    if (patch.customerId !== undefined) body.customerId = patch.customerId
    if (patch.siteId !== undefined) body.siteId = patch.siteId
    const res = await this.req<{ data: FergusJob } | FergusJob>('PUT', `/jobs/${jobId}`, body)
    return (res as { data: FergusJob })?.data ?? (res as FergusJob) ?? null
  }

  /**
   * Add labour + materials line items to a job. Fergus doesn't expose
   * /jobs/{id}/lineItems — line items belong to PHASES (/phases/{phaseId}/stockOnHand).
   * This helper fetches the job's phases, picks the first one (or creates a
   * default phase if none exists yet), and adds each line item there.
   */
  async addJobLineItems(jobId: number, items: Array<{
    description: string
    quantity?: number
    unitPrice?: number
    unitCost?: number
    itemType?: 'labour' | 'materials' | 'other'
  }>): Promise<Array<Record<string, unknown>>> {
    let phases = await this.listJobPhases(jobId)
    if (!phases.length) {
      // No phase yet — create a default one
      const created = await this.req<{ data: Record<string, unknown> } | Record<string, unknown>>(
        'POST', `/jobs/${jobId}/phases`, { title: 'Default', description: '' },
      )
      const c = (created as { data?: Record<string, unknown> })?.data ?? (created as Record<string, unknown>)
      phases = [c]
    }
    const firstPhase = phases[0]
    const phaseId = (firstPhase?.id ?? (firstPhase as { jobPhaseId?: number })?.jobPhaseId) as number | undefined
    if (!phaseId) throw new Error(`Could not resolve a phaseId for job ${jobId}`)

    const results = await Promise.all(
      items.map(it =>
        this.addPhaseStockOnHand(phaseId, {
          itemDescription: it.description,
          itemPrice: it.unitPrice,
          itemCost: it.unitCost,
          itemQuantity: it.quantity,
          isLabour: it.itemType === 'labour' ? true : (it.itemType === 'materials' ? false : undefined),
        }).catch(e => ({ error: e instanceof Error ? e.message : 'unknown', description: it.description })),
      ),
    )
    return results.map(r => (r as { data?: Record<string, unknown> })?.data ?? (r as Record<string, unknown>))
  }

  async completeJob(jobId: number): Promise<FergusJob | null> {
    // Fergus uses PUT /jobs/{id}/complete to mark a job as completed.
    try {
      const res = await this.req<{ data: FergusJob } | FergusJob>('PUT', `/jobs/${jobId}/complete`, {})
      return (res as { data: FergusJob })?.data ?? (res as FergusJob) ?? null
    } catch {
      // Fallback: some Fergus orgs expose status via the generic update endpoint
      return this.updateJob(jobId, { status: 'Completed' })
    }
  }

  async generateInvoiceFromJob(jobId: number): Promise<Record<string, unknown> | null> {
    // Fergus: POST /jobs/{id}/invoice → creates the invoice (and auto-syncs to Xero if connected).
    const res = await this.req<{ data: Record<string, unknown> } | Record<string, unknown>>('POST', `/jobs/${jobId}/invoice`, {})
    return (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>)
  }

  /**
   * Create a site. Fergus Partner API requires `defaultContact` + `siteAddress`
   * (camelCase). No `customerId` on the body — the customer-site link is made
   * later when the site is referenced on a job (or, more commonly, the agent
   * auto-creates one from a customer's physicalAddress before job-create).
   */
  async createSite(args: {
    defaultContact: FergusContact    // required; needs at least firstName
    siteAddress: FergusAddress        // required; address1 must be non-empty
    name?: string
    billingContact?: FergusContact
    postalAddress?: FergusAddress
  }): Promise<Record<string, unknown> | null> {
    // Fergus rejects siteAddress fields that are empty strings ("The address1
    // must not be empty"). Strip empties so only populated keys get sent.
    const stripEmpty = <T extends Record<string, unknown>>(o: T | undefined): T | undefined => {
      if (!o) return undefined
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string') {
          const t = v.trim()
          if (t) out[k] = t
        } else if (v !== undefined && v !== null) {
          out[k] = v
        }
      }
      return Object.keys(out).length ? (out as T) : undefined
    }
    const siteAddr = stripEmpty(args.siteAddress as unknown as Record<string, unknown>)
    if (!siteAddr || !(siteAddr as FergusAddress).address1) {
      throw new Error('Fergus createSite: siteAddress.address1 is required and must be non-empty')
    }
    const defaultContact = stripEmpty(args.defaultContact as unknown as Record<string, unknown>)
    if (!defaultContact || !(defaultContact as FergusContact).firstName) {
      throw new Error('Fergus createSite: defaultContact.firstName is required')
    }
    const body: Record<string, unknown> = { defaultContact, siteAddress: siteAddr }
    if (args.name) body.name = args.name
    const bc = stripEmpty(args.billingContact as unknown as Record<string, unknown>)
    if (bc) body.billingContact = bc
    const pa = stripEmpty(args.postalAddress as unknown as Record<string, unknown>)
    if (pa) body.postalAddress = pa
    const res = await this.req<{ data: Record<string, unknown> } | Record<string, unknown>>('POST', '/sites', body)
    return (res as { data?: Record<string, unknown> })?.data ?? (res as Record<string, unknown>)
  }

  /**
   * Fetch a job's phases — needed to add line items (which live on phases, not
   * jobs directly — POST /phases/{phaseId}/stockOnHand).
   */
  async listJobPhases(jobId: number): Promise<Array<Record<string, unknown>>> {
    const res = await this.req<{ data: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>('GET', `/jobs/${jobId}/phases`)
    return (res as { data?: Array<Record<string, unknown>> })?.data ?? (res as Array<Record<string, unknown>>) ?? []
  }

  /** Add a labour or materials line item to a job phase. */
  async addPhaseStockOnHand(phaseId: number, item: {
    itemDescription: string
    itemPrice?: number
    itemCost?: number
    itemQuantity?: number
    isLabour?: boolean
    salesAccountId?: number
    priceBookLineItemId?: number
  }): Promise<Record<string, unknown> | null> {
    const body: Record<string, unknown> = {
      itemDescription: item.itemDescription,
      itemPrice: item.itemPrice ?? 0,
      itemCost: item.itemCost ?? 0,
      itemQuantity: item.itemQuantity ?? 1,
    }
    if (item.priceBookLineItemId) {
      // Pricebook-referenced item — send id+qty only
      return await this.req<Record<string, unknown>>('POST', `/phases/${phaseId}/stockOnHand`, {
        priceBookLineItemId: item.priceBookLineItemId,
        itemQuantity: item.itemQuantity ?? 1,
      })
    }
    if (item.salesAccountId) body.salesAccountId = item.salesAccountId
    const created = await this.req<Record<string, unknown>>('POST', `/phases/${phaseId}/stockOnHand`, body)
    // If isLabour is specified, PATCH it after creation (Fergus doesn't accept it on create)
    if (item.isLabour !== undefined) {
      const stockId = (created as { data?: { id?: number }; id?: number })?.data?.id ?? (created as { id?: number })?.id
      if (stockId) {
        await this.req('PATCH', `/phases/${phaseId}/stockOnHand/${stockId}`, { isLabour: item.isLabour })
      }
    }
    return created as Record<string, unknown>
  }

  async uploadJobAttachment(jobId: number, fileName: string, content: Buffer, mimeType: string): Promise<Record<string, unknown> | null> {
    // Fergus attachments: multipart/form-data POST /jobs/{id}/attachments
    const form = new FormData()
    const blob = new Blob([new Uint8Array(content)], { type: mimeType })
    form.append('file', blob, fileName)
    const res = await fetch(`${FERGUS_BASE}/jobs/${jobId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      body: form,
    })
    if (!res.ok) {
      throw new Error(`Fergus uploadJobAttachment failed ${res.status}`)
    }
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return (payload as { data?: Record<string, unknown> })?.data ?? payload
  }

  /** Validate a PAT by hitting a read-only endpoint that returns 401 on bad token. */
  static async validatePat(token: string): Promise<{ valid: boolean; detail?: string }> {
    try {
      const res = await fetch(`${FERGUS_BASE}/users`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { valid: true }
      if (res.status === 401 || res.status === 403) return { valid: false, detail: 'Token rejected by Fergus' }
      return { valid: false, detail: `Fergus returned ${res.status}` }
    } catch (e) {
      return { valid: false, detail: e instanceof Error ? e.message : 'unknown error' }
    }
  }
}
