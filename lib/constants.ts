/* ── Nexley AI Constants ────────────────────────────── */

export const COST_PER_CALL_PENCE = 1500      // £15/call (receptionist equivalent — voice plan only)
export const COST_PER_MESSAGE_PENCE = 500    // £5/message handled (vs hiring admin to reply)
export const COST_PER_BOOKING_PENCE = 5000   // £50/booking made (vs admin scheduling time)
export const COST_PER_FOLLOWUP_PENCE = 200   // £2/follow-up (admin time saved)

export const AI_PHONE_NUMBER = '+44 7863 768330'
export const AI_PHONE_DISPLAY = '07863 768 330'

/** Status badge config — works in light & dark mode via CSS vars */
export const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  completed: { label: 'Answered',  className: 'bg-success/10 text-success' },
  failed:    { label: 'Failed',    className: 'bg-destructive/12 text-destructive' },
  no_answer: { label: 'Missed',    className: 'bg-warning/10 text-warning' },
  voicemail: { label: 'Voicemail', className: 'bg-primary/10 text-primary' },
  busy:      { label: 'Busy',      className: 'bg-destructive/12 text-destructive' },
}

// Direction has nothing to do with success/danger — both directions render
// in the same muted neutral. Was previously coloured (inbound = brand-primary,
// outbound = brand-success) which made every outbound call render in green
// and visually claim "money won" status. Now both are quiet.
export const DIRECTION_CONFIG: Record<string, { label: string; className: string }> = {
  inbound:  { label: 'Inbound',  className: 'text-muted-foreground' },
  outbound: { label: 'Outbound', className: 'text-muted-foreground' },
}

export const PLAN_PRICES_PENCE: Record<string, number> = {
  free: 0,
  trial: 1999,
  employee: 59900,
  voice: 99900,
}

export const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  trial: '5-day trial — £19.99',
  employee: 'AI Employee — £599/mo',
  voice: 'AI Employee + Voice — £999/mo',
}

/**
 * Pipeline stages — v2.
 *
 * Earlier draft used a 9-colour rainbow (purple / cyan / orange / pink for
 * the middle stages). This propagated to KanbanColumn dots, FunnelChart
 * cells, Calendar event pills, Reporting Stage Breakdown, and the contact
 * detail stage badge — five surfaces literally lit up like a fruit
 * machine. v2 collapses to a 3-step semantic ramp:
 *
 *   - "starting" stages (new / contacted / qualified)        → muted gray
 *   - "in-flight" stages (demo / proposal / negotiation)     → primary navy
 *   - "won"                                                  → success green
 *   - "lost"                                                 → muted gray (NOT red — losses
 *                                                              are a normal funnel reality, not
 *                                                              an error state)
 *
 * Differentiation between adjacent stages comes from the LABEL, not the
 * COLOUR (Linear/Stripe pattern). The funnel chart still ramps lightness
 * from start→won via OKLCH so columns remain visually distinct without
 * five different hues fighting for attention.
 *
 * The legacy `color` and `hex` fields are kept on the type so existing
 * callsites compile, but every consumer should read `tone` (the semantic
 * v2 token) — `hex` falls back to the OKLCH-resolved primary.
 */
export const PIPELINE_STAGES = [
  { key: 'new',          label: 'New Lead',     tone: 'muted',   color: 'muted-foreground', hex: '#6B6B78' },
  { key: 'contacted',    label: 'Contacted',    tone: 'muted',   color: 'muted-foreground', hex: '#6B6B78' },
  { key: 'qualified',    label: 'Qualified',    tone: 'primary', color: 'primary',          hex: '#3850A0' },
  { key: 'demo_booked',  label: 'Demo Booked',  tone: 'primary', color: 'primary',          hex: '#3850A0' },
  { key: 'demo_done',    label: 'Demo Done',    tone: 'primary', color: 'primary',          hex: '#3850A0' },
  { key: 'proposal',     label: 'Proposal',     tone: 'primary', color: 'primary',          hex: '#3850A0' },
  { key: 'negotiation',  label: 'Negotiation',  tone: 'primary', color: 'primary',          hex: '#3850A0' },
  { key: 'won',          label: 'Won',          tone: 'success', color: 'brand-success',    hex: '#22C55E' },
  { key: 'lost',         label: 'Lost',         tone: 'muted',   color: 'muted-foreground', hex: '#6B6B78' },
] as const

export type PipelineStageKey = typeof PIPELINE_STAGES[number]['key']
export type PipelineStageTone = 'muted' | 'primary' | 'success'

export const SUBSCRIPTION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  trial:     { label: 'Trial',     className: 'bg-primary/10 text-primary' },
  active:    { label: 'Active',    className: 'bg-success/10 text-success' },
  paused:    { label: 'Paused',    className: 'bg-warning/10 text-warning' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
}
