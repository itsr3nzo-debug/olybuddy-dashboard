/**
 * Per-customer LLM budget — atomic counter with soft degradation.
 *
 * Tier mapping (per DA — hard cutoff was unacceptable customer UX):
 *
 *   spent < 80 % cap   → 'normal'              run on Sonnet
 *   80% ≤ spent < 100% → 'degraded'            switch to Haiku
 *   100% ≤ spent < 150% → 'queue_for_approval' generate but don't auto-send,
 *                                              owner approves on mobile
 *   spent ≥ 150% cap   → 'hard_capped'         AI Employee paused, owner alerted
 *
 * Caps are derived from plan + a daily-rolling window, NOT monthly. A
 * runaway prompt-injection loop blowing £25 in 10 minutes is caught same-day.
 *
 * Atomicity: `record_llm_spend` (Postgres function) does INSERT ... ON
 * CONFLICT DO UPDATE ... RETURNING in a single statement — no read-then-act
 * race even under concurrency.
 */

import { createUntypedServiceClient } from '@/lib/supabase/untyped'


function service() {
  return createUntypedServiceClient()
}

export type BudgetTier = 'normal' | 'degraded' | 'queue_for_approval' | 'hard_capped'

// Daily caps in pence. Tune from real usage.
//   trial             £1.50/day  (≈ £45/mo)
//   ai_employee       £5/day     (≈ £150/mo)
//   ai_employee_plus  £15/day    (≈ £450/mo, current top tier)
//   full_build        £30/day    (custom — also bills overage at cost+30%)
const DAILY_CAP_PENCE: Record<string, number> = {
  free_demo: 50,
  trial: 150,
  ai_employee_trial: 150,
  ai_employee: 500,
  ai_employee_plus: 1500,
  custom_domain: 500,
  full_build: 3000,
}

function capForPlan(plan: string | null | undefined): number {
  if (!plan) return DAILY_CAP_PENCE.trial
  return DAILY_CAP_PENCE[plan] ?? DAILY_CAP_PENCE.trial
}

/**
 * Pre-flight check — call BEFORE making the LLM call to decide which model
 * tier to route to. Cheap (single index lookup, no writes).
 */
export async function getBudgetTier(
  clientId: string,
  plan: string | null | undefined
): Promise<BudgetTier> {
  const sb = service()
  const cap = capForPlan(plan)
  const { data, error } = await sb.rpc('get_budget_tier', {
    p_client_id: clientId,
    p_default_cap_pence: cap,
  })
  if (error) {
    console.error('[budget] tier check failed, defaulting to normal:', error)
    return 'normal'
  }
  // get_budget_tier (plpgsql) returns a single text value
  const tier = (Array.isArray(data) ? data[0] : data) as BudgetTier | string | null
  if (typeof tier === 'string' && isBudgetTier(tier)) return tier
  return 'normal'
}

/**
 * Atomic version of getBudgetTier (DA fix B10). reserveBudgetAtomic SQL
 * function uses INSERT ... ON CONFLICT DO UPDATE ... RETURNING to read the
 * canonical row state in a single statement, avoiding the read-then-act
 * race that plain getBudgetTier suffers under burst concurrency.
 *
 * Use this on hot-path inference; getBudgetTier remains for read-only
 * pre-flight checks where staleness is acceptable.
 */
export async function reserveBudgetTier(
  clientId: string,
  plan: string | null | undefined
): Promise<BudgetTier> {
  const sb = service()
  const cap = capForPlan(plan)
  const { data, error } = await sb.rpc('reserve_budget_atomic', {
    p_client_id: clientId,
    p_default_cap_pence: cap,
  })
  if (error) {
    console.error('[budget] reserve failed, defaulting to normal:', error)
    return 'normal'
  }
  const row = Array.isArray(data) ? data[0] : data
  const r = row as { tier?: string } | null
  if (r?.tier && isBudgetTier(r.tier)) return r.tier as BudgetTier
  return 'normal'
}

function isBudgetTier(s: string): s is BudgetTier {
  return s === 'normal' || s === 'degraded' || s === 'queue_for_approval' || s === 'hard_capped'
}

/**
 * After a successful LLM call: record the cost and return the new tier.
 * The RPC is atomic — concurrent calls correctly accumulate.
 */
export async function recordLlmSpend(
  clientId: string,
  pencePence: number,
  plan: string | null | undefined
): Promise<{ tier: BudgetTier; spentPence: number; capPence: number }> {
  const sb = service()
  const cap = capForPlan(plan)
  const { data, error } = await sb.rpc('record_llm_spend', {
    p_client_id: clientId,
    p_pence: Math.max(1, Math.round(pencePence)),
    p_default_cap_pence: cap,
  })
  if (error) {
    console.error('[budget] record_llm_spend failed:', error)
    return { tier: 'normal', spentPence: 0, capPence: cap }
  }
  const row = Array.isArray(data) ? data[0] : data
  const r = row as { spent_pence: number; cap_pence: number; tier: BudgetTier } | null
  return {
    tier: r?.tier ?? 'normal',
    spentPence: r?.spent_pence ?? 0,
    capPence: r?.cap_pence ?? cap,
  }
}

/**
 * Cost calculator — given Anthropic usage, return pence.
 * Prices in £ per million tokens (April 2026). Update when Anthropic re-prices.
 */
const PRICES_GBP_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite5m: number }> = {
  'claude-sonnet-4-6-20260401': { input: 2.4, output: 12.0, cacheRead: 0.24, cacheWrite5m: 3.0 },
  'claude-haiku-4-5-20251001':  { input: 0.6, output: 3.0,  cacheRead: 0.06, cacheWrite5m: 0.75 },
  'claude-opus-4-7-20260425':   { input: 12.0, output: 60.0, cacheRead: 1.2, cacheWrite5m: 15.0 },
}

export function computeCostPence(
  modelId: string,
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  }
): number {
  const p = PRICES_GBP_PER_MTOK[modelId]
  if (!p) {
    console.warn(`[budget] no price for model ${modelId}, falling back to sonnet`)
    return computeCostPence('claude-sonnet-4-6-20260401', usage)
  }
  const totalGbp =
    (usage.inputTokens / 1_000_000) * p.input +
    (usage.outputTokens / 1_000_000) * p.output +
    (usage.cacheReadTokens / 1_000_000) * p.cacheRead +
    (usage.cacheCreationTokens / 1_000_000) * p.cacheWrite5m
  return Math.ceil(totalGbp * 100)
}
