/* ── Olybuddy Constants ────────────────────────────── */

export const COST_PER_CALL_PENCE = 1500      // £15/call (receptionist equivalent)
export const COST_PER_FOLLOWUP_PENCE = 200   // £2/follow-up (admin time saved)

export const AI_PHONE_NUMBER = '+44 7863 768330'
export const AI_PHONE_DISPLAY = '07863 768 330'

/** Status badge config — works in light & dark mode via CSS vars */
export const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  completed: { label: 'Answered',  className: 'bg-brand-success/10 text-brand-success' },
  failed:    { label: 'Failed',    className: 'bg-brand-danger/10 text-brand-danger' },
  no_answer: { label: 'Missed',    className: 'bg-brand-warning/10 text-brand-warning' },
  voicemail: { label: 'Voicemail', className: 'bg-brand-info/10 text-brand-info' },
  busy:      { label: 'Busy',      className: 'bg-brand-danger/10 text-brand-danger' },
}

export const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  inbound:  { label: 'Inbound',  className: 'text-brand-primary' },
  outbound: { label: 'Outbound', className: 'text-brand-success' },
}

export const PLAN_PRICES_PENCE: Record<string, number> = {
  free: 0,
  starter: 9900,
  pro: 19900,
  enterprise: 39900,
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter — £99/mo',
  pro: 'Pro — £199/mo',
  enterprise: 'Enterprise — £399/mo',
}

export const SUBSCRIPTION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  trial:     { label: 'Trial',     className: 'bg-brand-warning/10 text-brand-warning' },
  active:    { label: 'Active',    className: 'bg-brand-success/10 text-brand-success' },
  paused:    { label: 'Paused',    className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-brand-danger/10 text-brand-danger' },
}
