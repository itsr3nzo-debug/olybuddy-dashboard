/**
 * Shared helper: emit a signal into integration_signals so the VPS agent's
 * polling loop picks it up and WhatsApps the owner.
 *
 * Every briefing / chase / guard writes through this so dedup + urgency
 * + logging are consistent across features.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

export type SignalType =
  | 'owner_briefing_morning'
  | 'owner_briefing_weekly'
  | 'fergus_quote_chase'
  | 'xero_debtor_chase'
  | 'fergus_deposit_guard'
  | 'fergus_profit_guard'
  | 'fergus_service_recall'
  | 'review_request_after_paid'

export type Urgency = 'low' | 'normal' | 'urgent' | 'emergency'

export interface EmitArgs {
  sb: SupabaseClient
  clientId: string
  signalType: SignalType
  dedupKey: string               // stable string so repeat emits within a window are idempotent
  summary: string                // the WhatsApp-ready message body for the agent to send
  urgency?: Urgency
  sourceRef?: string             // Fergus job/quote id, Xero invoice id, etc
  proposedAction?: string        // "Send to owner" / "Ask owner approval" etc.
  extractedContext?: Record<string, unknown>
}

export async function emitAgentSignal(args: EmitArgs): Promise<{ ok: boolean; signalId: string; skipped?: 'duplicate' }> {
  const signalId = crypto
    .createHash('sha256')
    .update(`${args.clientId}:${args.signalType}:${args.dedupKey}`)
    .digest('hex')
    .slice(0, 32)

  const { error } = await args.sb
    .from('integration_signals')
    .upsert(
      {
        client_id: args.clientId,
        signal_id: signalId,
        provider: 'fergus',
        signal_type: args.signalType,
        detected_at_iso: new Date().toISOString(),
        source_ref: args.sourceRef ?? null,
        summary: args.summary,
        urgency: args.urgency ?? 'normal',
        confidence: 1,
        status: 'new',
        proposed_action: args.proposedAction ?? 'Send to owner on WhatsApp for approval/review.',
        extracted_context: args.extractedContext ?? {},
      },
      { onConflict: 'client_id,signal_id', ignoreDuplicates: true },
    )
  if (error) return { ok: false, signalId }
  return { ok: true, signalId }
}

/** Fetch every client with a connected Fergus integration — the usual loop target. */
export async function connectedFergusClients(sb: SupabaseClient): Promise<Array<{ client_id: string }>> {
  const { data } = await sb
    .from('integrations')
    .select('client_id')
    .eq('provider', 'fergus')
    .eq('status', 'connected')
  return (data ?? []) as Array<{ client_id: string }>
}

/** Fetch every client with BOTH Fergus AND Xero connected. */
export async function connectedFergusXeroClients(sb: SupabaseClient): Promise<Array<{ client_id: string }>> {
  const { data } = await sb
    .from('integrations')
    .select('client_id, provider')
    .in('provider', ['fergus', 'xero'])
    .eq('status', 'connected')
  const byClient = new Map<string, Set<string>>()
  for (const r of data ?? []) {
    const row = r as { client_id: string; provider: string }
    const set = byClient.get(row.client_id) ?? new Set()
    set.add(row.provider)
    byClient.set(row.client_id, set)
  }
  return [...byClient.entries()]
    .filter(([, providers]) => providers.has('fergus') && providers.has('xero'))
    .map(([client_id]) => ({ client_id }))
}

/** Connected Xero-only (for debtor chase). */
export async function connectedXeroClients(sb: SupabaseClient): Promise<Array<{ client_id: string }>> {
  const { data } = await sb
    .from('integrations')
    .select('client_id')
    .eq('provider', 'xero')
    .eq('status', 'connected')
  return (data ?? []) as Array<{ client_id: string }>
}

/** Convenience: round a GBP amount to £X,XXX.XX format. */
export function gbp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '£—'
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
