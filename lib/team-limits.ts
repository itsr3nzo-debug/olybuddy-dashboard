/**
 * Team-size caps per subscription plan. Enforced server-side in
 * /api/team/invite so the invite call fails before we create the auth
 * user (would otherwise leave orphan "invited but over cap" rows).
 *
 * The UI mirrors these numbers on TeamSection so the owner sees
 * "2 of 3 members used" rather than hitting the cap as a surprise 403.
 *
 * Caps are deliberately generous on paid plans — small UK service
 * businesses rarely need more than 3-5 seats. Enterprise is effectively
 * uncapped (25 seats) to not block internal Nexley use.
 */

export type TeamSizeCap = number | 'unlimited'

export interface TeamLimitInfo {
  plan: string
  cap: TeamSizeCap
  /** Human-readable label, e.g. "3 seats" or "unlimited seats". */
  label: string
}

const PLAN_CAPS: Record<string, TeamSizeCap> = {
  // Nexley's plan tiers. Anything unknown falls back to the conservative
  // trial cap of 1 so we never let an unmapped plan invite unbounded.
  trial: 1,
  employee: 3,
  pro: 5,
  enterprise: 25,
}

export function getTeamLimit(subscriptionPlan: string | null | undefined): TeamLimitInfo {
  const plan = (subscriptionPlan ?? 'trial').toLowerCase()
  const cap = PLAN_CAPS[plan] ?? 1
  return {
    plan,
    cap,
    label: cap === 'unlimited' ? 'unlimited seats' : `${cap} seat${cap === 1 ? '' : 's'}`,
  }
}

/** True when `currentCount` is already at or above the cap. */
export function isAtCap(currentCount: number, cap: TeamSizeCap): boolean {
  if (cap === 'unlimited') return false
  return currentCount >= cap
}
