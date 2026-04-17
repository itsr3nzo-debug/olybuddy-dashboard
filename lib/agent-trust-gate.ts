/**
 * Server-side trust-level enforcement for agent-proxy endpoints.
 *
 * The trust-routing skill on the VPS is best-effort — a compromised VPS or a
 * bug in the skill could send a write action that the owner never approved.
 * This module enforces the policy on the dashboard side, which is the
 * only trust boundary we can actually guarantee.
 */

import { NextResponse } from 'next/server'
import { AgentContext } from '@/lib/agent-auth'

export type AgentActionClass =
  | 'ack'                         // throwaway replies, always allowed
  | 'read_only'                   // GET requests, always allowed (rate-limit only)
  | 'draft_write'                 // DRAFT invoice / Fergus open-job — visible to owner only
  | 'send_small_external'         // auto-email / send-SMS to customer below threshold
  | 'send_big_external'           // auto-email / send-SMS above threshold (needs TL3)
  | 'financial_mutation'          // record_payment, authorise_invoice — always need TL3
  | 'destructive'                 // delete/void — never allowed over agent API, owner only via dashboard

export interface TrustDecision {
  allowed: boolean
  reason?: string
  response?: NextResponse
}

/**
 * Check if the agent's trust level permits this action class.
 * Call this BEFORE executing any write. Return the NextResponse (403) if rejected.
 */
export function enforceTrust(ctx: AgentContext, action: AgentActionClass, amountGbp?: number, thresholdGbp = 100): TrustDecision {
  const tl = ctx.trustLevel ?? 1

  // Destructive actions are never allowed from the agent API.
  if (action === 'destructive') {
    return reject(`destructive actions not permitted via agent API (TL=${tl})`)
  }

  // Always-allowed classes.
  if (action === 'ack' || action === 'read_only') {
    return { allowed: true }
  }

  // Trust Level 0 — Shadow. No writes at all.
  if (tl === 0) {
    return reject(`shadow mode (TL=0) blocks all writes. Action: ${action}`)
  }

  // Trust Level 1 — Confirm all. Only drafts allowed. External sends blocked.
  if (tl === 1) {
    if (action === 'draft_write') return { allowed: true }
    return reject(`TL=1 permits drafts only — owner must approve external sends via dashboard. Blocked: ${action}`)
  }

  // Trust Level 2 — Confirm above threshold.
  if (tl === 2) {
    if (action === 'draft_write') return { allowed: true }
    if (action === 'send_small_external') {
      if (typeof amountGbp === 'number' && amountGbp > thresholdGbp) {
        return reject(`TL=2 blocks external sends > £${thresholdGbp}. This action is £${amountGbp}.`)
      }
      return { allowed: true }
    }
    if (action === 'send_big_external' || action === 'financial_mutation') {
      return reject(`TL=2 requires TL=3 for ${action}. Amount: £${amountGbp ?? 'unknown'}. Owner must approve via dashboard first.`)
    }
  }

  // Trust Level 3 — Full trust. Destructive is already rejected above.
  if (tl === 3) {
    return { allowed: true }
  }

  return reject(`unknown trust level ${tl}`)
}

function reject(reason: string): TrustDecision {
  return {
    allowed: false,
    reason,
    response: NextResponse.json(
      { error: 'Blocked by trust level', detail: reason },
      { status: 403 },
    ),
  }
}

/**
 * Sanitise an error for external return. Strips anything that could leak
 * upstream tokens, stack traces, or internal paths.
 */
export function safeErrorDetail(err: unknown): string {
  if (err instanceof Error) {
    // Strip anything that looks like a bearer or refresh token
    return err.message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
      .replace(/(refresh_token|access_token|sk-[A-Za-z0-9_-]+|oak_[A-Za-z0-9_-]+)/g, '***')
      .slice(0, 200)
  }
  return String(err).slice(0, 200)
}
