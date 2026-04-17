/**
 * Fergus REST client.
 *
 * Fergus API: https://api.fergus.com (Swagger at /docs)
 * Auth: Personal Access Token (user-generated in Fergus UI) sent as
 * `Authorization: Bearer <token>`.
 *
 * Trade-business use cases we target:
 *  - Push captured job (voice-note → structured job record in Fergus)
 *  - Read open jobs (for owner status + follow-up reminders)
 *  - Read customer history (for context on incoming WhatsApp enquiries)
 *  - Check invoice status (for chasing unpaid customers)
 */

import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/encryption'

const FERGUS_BASE = 'https://api.fergus.com/api/v1'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export interface FergusJobInput {
  customer_id?: number // if null, caller must supply customer_name + customer_phone
  customer_name?: string
  customer_phone?: string
  customer_email?: string
  site_address?: string
  description: string
  estimated_value_pence?: number
  scheduled_for?: string // ISO date
  internal_notes?: string
  source?: string // e.g., "WhatsApp", "Voice note", "Customer form"
}

export interface FergusJob {
  id: number
  job_number?: string
  status: string // "draft" | "in_progress" | "completed" | "invoiced" | ...
  customer: { id: number; name: string; phone?: string; email?: string }
  site: { address?: string }
  description: string
  created_at: string
  scheduled_for?: string
  total_value_pence?: number
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
      .select('access_token_enc, status')
      .eq('client_id', clientUuid)
      .eq('provider', 'fergus')
      .eq('status', 'connected')
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
      throw new Error(`Fergus ${method} ${path} failed ${res.status}: ${txt.slice(0, 300)}`)
    }
    if (res.status === 204) return null as T
    return (await res.json()) as T
  }

  // ─── Customers ─────────────────────────────────────────
  async searchCustomers(q: string): Promise<Array<{ id: number; name: string; phone?: string; email?: string }>> {
    const res = await this.req<{ data: Array<{ id: number; name: string; phone?: string; email?: string }> }>(
      'GET',
      `/customers?search=${encodeURIComponent(q)}&limit=10`,
    )
    return res?.data ?? []
  }

  async createCustomer(c: { name: string; phone?: string; email?: string; address?: string }): Promise<{ id: number }> {
    const res = await this.req<{ data: { id: number } }>('POST', `/customers`, {
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
    })
    return res.data
  }

  // ─── Jobs ──────────────────────────────────────────────
  async createJob(input: FergusJobInput): Promise<FergusJob> {
    // Resolve or create the customer
    let customerId = input.customer_id
    if (!customerId) {
      if (!input.customer_name) throw new Error('customer_id OR customer_name required')
      const existing = await this.searchCustomers(input.customer_name)
      const match = existing.find(c => c.name.toLowerCase() === input.customer_name!.toLowerCase())
      customerId = match?.id ?? (await this.createCustomer({
        name: input.customer_name,
        phone: input.customer_phone,
        email: input.customer_email,
        address: input.site_address,
      })).id
    }

    const res = await this.req<{ data: FergusJob }>('POST', `/jobs`, {
      customer_id: customerId,
      site_address: input.site_address,
      description: input.description,
      estimated_value_pence: input.estimated_value_pence,
      scheduled_for: input.scheduled_for,
      internal_notes: input.internal_notes,
      source: input.source ?? 'Nexley AI',
    })
    return res.data
  }

  async listOpenJobs(): Promise<FergusJob[]> {
    const res = await this.req<{ data: FergusJob[] }>('GET', `/jobs?status=open&limit=50`)
    return res?.data ?? []
  }

  async getJob(jobId: number): Promise<FergusJob | null> {
    try {
      const res = await this.req<{ data: FergusJob }>('GET', `/jobs/${jobId}`)
      return res?.data ?? null
    } catch {
      return null
    }
  }

  async updateJobStatus(jobId: number, status: 'open' | 'in_progress' | 'completed' | 'invoiced'): Promise<void> {
    await this.req('PATCH', `/jobs/${jobId}`, { status })
  }

  // ─── Current user (used for PAT validation) ────────────
  async currentUser(): Promise<{ id: number; email: string; name: string }> {
    return this.req<{ id: number; email: string; name: string }>('GET', `/current_user`)
  }
}
