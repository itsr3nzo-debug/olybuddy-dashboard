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
export type FergusJobType = 'Service Call' | 'Install' | 'Maintenance' | 'Inspection' | 'Emergency Callout' | string

export interface FergusAddress {
  addressLine1?: string
  addressLine2?: string
  addressSuburb?: string
  addressCity?: string
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
      throw new Error(`Fergus ${method} ${path} failed ${res.status}`)
    }
    if (res.status === 204) return null as T
    return (await res.json()) as T
  }

  // ─── Customers ─────────────────────────────────────────
  async searchCustomers(q: string): Promise<FergusCustomer[]> {
    // Fergus supports LIKE-style search on customerFullName via `search` or `filter` params.
    // Based on the MCP source, `search=<query>` is the standard.
    const res = await this.req<{ data: FergusCustomer[] }>('GET', `/customers?search=${encodeURIComponent(q)}&pageSize=10`)
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
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?pageSize=10&filterJobNo=${encodeURIComponent(jobNo)}`)
    return res?.data ?? []
  }

  async listOpenJobs(pageSize = 25): Promise<FergusJob[]> {
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?pageSize=${pageSize}`)
    return (res?.data ?? []).filter(j => !j.isDraft)
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
