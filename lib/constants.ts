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
  trial: 2000,
  employee: 59900,
  voice: 99900,
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  trial: '5-Day Trial — £20',
  employee: 'AI Employee — £599/mo',
  voice: 'AI Employee + Voice — £999/mo',
}

export const PIPELINE_STAGES = [
  { key: 'new',          label: 'New Lead',     color: 'brand-primary',  hex: '#6366f1' },
  { key: 'contacted',    label: 'Contacted',    color: 'brand-warning',  hex: '#f59e0b' },
  { key: 'qualified',    label: 'Qualified',    color: 'brand-info',     hex: '#3b82f6' },
  { key: 'demo_booked',  label: 'Demo Booked',  color: 'purple-500',     hex: '#a855f7' },
  { key: 'demo_done',    label: 'Demo Done',    color: 'cyan-500',       hex: '#06b6d4' },
  { key: 'proposal',     label: 'Proposal',     color: 'orange-500',     hex: '#f97316' },
  { key: 'negotiation',  label: 'Negotiation',  color: 'pink-500',       hex: '#ec4899' },
  { key: 'won',          label: 'Won',          color: 'brand-success',  hex: '#22c55e' },
  { key: 'lost',         label: 'Lost',         color: 'brand-danger',   hex: '#ef4444' },
] as const

export type PipelineStageKey = typeof PIPELINE_STAGES[number]['key']

export const SUBSCRIPTION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  trial:     { label: 'Trial',     className: 'bg-brand-warning/10 text-brand-warning' },
  active:    { label: 'Active',    className: 'bg-brand-success/10 text-brand-success' },
  paused:    { label: 'Paused',    className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-brand-danger/10 text-brand-danger' },
}
