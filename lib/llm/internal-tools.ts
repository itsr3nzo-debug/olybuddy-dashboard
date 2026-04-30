/**
 * Internal tool dispatch — replaces the stubs in lib/llm/tools.ts.
 *
 * Three tools the AI Employee can call directly (no Composio hop):
 *
 *   • lookup_customer  — find a contact by phone or email
 *   • create_estimate  — draft a quote (idempotent — same line items twice = same estimate row)
 *   • log_action       — record a value-tracked action for ROI dashboard
 *
 * Per Anthropic 2026 docs (handle-tool-calls): tool_result content can be a
 * plain string. Errors are surfaced as `is_error: true` text — the model
 * reads it, corrects, retries (up to MAX_TOOL_LOOPS in the SSE route).
 *
 * Idempotency: write tools (`create_estimate`, `log_action`) hash their
 * input and ON CONFLICT DO NOTHING — replay-safe. The hash is the dedupe
 * key, computed deterministically from input contents.
 */

import { createUntypedServiceClient } from '@/lib/supabase/untyped'


let _sb: import("@/lib/supabase/untyped").UntypedSupabase | null = null
function service() {
  if (!_sb) {
    _sb = createUntypedServiceClient()
  }
  return _sb
}

export interface InternalToolContext {
  clientId: string
  userId: string
}

export interface InternalToolResult {
  ok: boolean
  data: unknown
}

export async function dispatchInternalTool(
  fn: string,
  input: unknown,
  ctx: InternalToolContext
): Promise<InternalToolResult> {
  switch (fn) {
    case 'lookupCustomer': return lookupCustomer(input, ctx)
    case 'createEstimate': return createEstimate(input, ctx)
    case 'logAction':      return logAction(input, ctx)
    default:
      return {
        ok: false,
        data: { error: `Unknown internal tool: ${fn}`, is_error: true },
      }
  }
}

// ---------------------------------------------------------------------------
// lookup_customer
// ---------------------------------------------------------------------------

interface LookupInput {
  phone?: string
  email?: string
}

async function lookupCustomer(input: unknown, ctx: InternalToolContext): Promise<InternalToolResult> {
  const i = input as LookupInput
  if (!i?.phone && !i?.email) {
    return { ok: false, data: { error: 'Must provide phone or email', is_error: true } }
  }
  const sb = service()
  // contacts schema: first_name + last_name (no `name`), phone/whatsapp, email,
  // last_contacted (no `last_contacted_at`), no `notes` column. Use first/last_name + custom_fields.
  let q = sb
    .from('contacts')
    .select('id, first_name, last_name, phone, whatsapp, email, custom_fields, last_contacted, created_at')
    .eq('client_id', ctx.clientId)
    .limit(1)
  if (i.phone) q = q.or(`phone.eq.${i.phone},whatsapp.eq.${i.phone}`)
  else if (i.email) q = q.eq('email', i.email)
  const { data, error } = await q.maybeSingle()
  if (error) {
    return { ok: false, data: { error: error.message, is_error: true } }
  }
  if (!data) {
    return {
      ok: true,
      data: {
        found: false,
        hint: 'No matching contact. The customer may be new — capture their details before booking.',
      },
    }
  }
  return { ok: true, data: { found: true, contact: data } }
}

// ---------------------------------------------------------------------------
// create_estimate (idempotent)
// ---------------------------------------------------------------------------

interface EstimateLine {
  description: string
  quantity: number
  unit_price_pence: number
}
interface EstimateInput {
  customer_id?: string
  line_items: EstimateLine[]
  notes?: string
}

async function hashInput(o: unknown): Promise<string> {
  const buf = new TextEncoder().encode(JSON.stringify(o))
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function createEstimate(input: unknown, ctx: InternalToolContext): Promise<InternalToolResult> {
  const i = input as EstimateInput
  if (!Array.isArray(i?.line_items) || i.line_items.length === 0) {
    return { ok: false, data: { error: 'line_items required', is_error: true } }
  }
  for (const line of i.line_items) {
    if (typeof line.description !== 'string' || line.description.length === 0) {
      return { ok: false, data: { error: 'each line needs description', is_error: true } }
    }
    if (typeof line.quantity !== 'number' || line.quantity <= 0) {
      return { ok: false, data: { error: 'quantity must be positive number', is_error: true } }
    }
    if (typeof line.unit_price_pence !== 'number' || line.unit_price_pence < 0) {
      return { ok: false, data: { error: 'unit_price_pence must be non-negative integer', is_error: true } }
    }
  }

  const dedupeKey = await hashInput({
    client_id: ctx.clientId,
    customer_id: i.customer_id ?? null,
    lines: i.line_items,
  })

  const sb = service()
  const totalPence = i.line_items.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price_pence), 0)

  // Idempotent insert via deterministic dedupe_key column.
  // Schema-aware: most existing estimates table won't have a dedupe_key
  // column yet — we degrade gracefully if the column is missing.
  let row
  const ins = await sb
    .from('estimates')
    .insert({
      client_id: ctx.clientId,
      contact_id: i.customer_id ?? null,
      total_pence: totalPence,
      line_items: i.line_items,
      notes: i.notes ?? null,
      status: 'pending_owner_review',
      created_by_ai: true,
      dedupe_key: dedupeKey,
    })
    .select('id, total_pence, status')
    .maybeSingle()
  if (ins.error) {
    // Unique-violation = already exists; look it up
    if ((ins.error as { code?: string }).code === '23505') {
      const existing = await sb
        .from('estimates')
        .select('id, total_pence, status')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle()
      row = existing.data
    } else {
      return { ok: false, data: { error: ins.error.message, is_error: true } }
    }
  } else {
    row = ins.data
  }

  return {
    ok: true,
    data: {
      estimate_id: row?.id,
      total_pence: row?.total_pence,
      status: row?.status,
      message: 'Estimate drafted. Awaiting owner review before sending.',
    },
  }
}

// ---------------------------------------------------------------------------
// log_action (idempotent)
// ---------------------------------------------------------------------------

interface LogActionInput {
  category: 'message_handled' | 'call_taken' | 'booking_made' | 'estimate_drafted' | 'lead_qualified'
  summary: string
  value_gbp?: number
  minutes_saved?: number
}

async function logAction(input: unknown, ctx: InternalToolContext): Promise<InternalToolResult> {
  const i = input as LogActionInput
  // DA fix C9: validate against the actual DB CHECK constraint values, not
  // an aspirational set. The constraint was extended in the
  // extend_agent_actions_categories migration to add the values below.
  const allowed = [
    'message_handled', 'call_taken', 'booking_made', 'estimate_drafted',
    'lead_qualified', 'expense_logged', 'materials_logged', 'contact_added',
    'enquiry_qualified', 'follow_up_sent', 'escalation_to_owner',
  ]
  if (!allowed.includes(i?.category)) {
    return { ok: false, data: { error: `category must be one of ${allowed.join(', ')}`, is_error: true } }
  }
  if (typeof i.summary !== 'string' || i.summary.length === 0) {
    return { ok: false, data: { error: 'summary required', is_error: true } }
  }

  const dedupeKey = await hashInput({
    client_id: ctx.clientId,
    category: i.category,
    summary: i.summary,
    minute_bucket: Math.floor(Date.now() / 60_000),  // dedupe within 1-min window
  })

  const sb = service()
  // agent_actions schema (verified live 2026-04-29):
  //   id, client_id, occurred_at, category, contact_phone, contact_name,
  //   summary, value_gbp, minutes_saved, related_table, related_id, meta,
  //   outcome_tag, outcome_scored_at, skill_used, dedupe_key
  // We always set occurred_at + meta (NOT NULL columns).
  const { error } = await sb.from('agent_actions').insert({
    client_id: ctx.clientId,
    occurred_at: new Date().toISOString(),
    category: i.category,
    summary: i.summary,
    value_gbp: i.value_gbp ?? null,
    minutes_saved: i.minutes_saved ?? null,
    meta: { source: 'mobile_internal_tool' },
    dedupe_key: dedupeKey,
  })
  if (error && (error as { code?: string }).code !== '23505') {
    return { ok: false, data: { error: error.message, is_error: true } }
  }
  return { ok: true, data: { logged: true } }
}
