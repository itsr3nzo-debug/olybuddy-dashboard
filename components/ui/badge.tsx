/**
 * Badge — v2.
 *
 * Status-tinted pill used wherever a row needs a one-word state marker
 * (Connected / Trial / Failed / etc). Used by `<StatusBadge>` and
 * `<DirectionBadge>` and directly across calls / contacts / conversations
 * / integrations / admin / estimates / variations / signals.
 *
 * v2 changes:
 *  - Variants now read v2 semantic tokens (`success` / `warning` /
 *    `destructive` / `primary` / `muted-foreground`) instead of raw
 *    Tailwind colour ladders (`emerald-400` / `amber-500` / `red-500`).
 *    This single edit propagates the v2 palette to every status pill in
 *    the app — without it, ~30 callsites stayed on the legacy hue stack.
 *  - Drop the explicit border. The 1px hairline `border` was visually
 *    redundant against the tinted `bg-{token}/10` surface; now it's
 *    border-less by default for a softer Linear/Stripe look. The tinted
 *    bg + tinted text already define the chip.
 *  - `info` was its own colour (blue-400) — folded into `primary` since
 *    we have one accent (navy) and "info" status looks identical to
 *    "active primary thing".
 *
 * Backwards-compatible: variant names unchanged.
 */

interface BadgeProps {
  label: string
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'
  size?: 'sm' | 'md'
  className?: string
}

const VARIANTS = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger:  'bg-destructive/12 text-destructive',
  // info + brand both collapse onto the single primary accent. We have
  // ONE accent in the v2 palette — there is no "info blue / brand navy"
  // distinction to draw any more.
  info:    'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
  brand:   'bg-primary/10 text-primary',
}

const SIZES = {
  // 18px tall, tight padding — Linear/Stripe pill-pattern at 10px label
  sm: 'h-[18px] px-1.5 text-[10px]',
  // 22px tall, used inside cards / next to titles
  md: 'h-[22px] px-2 text-[11px]',
}

export function Badge({ label, variant = 'neutral', size = 'sm', className }: BadgeProps) {
  return (
    <span
      className={
        'inline-flex items-center font-medium rounded-sm whitespace-nowrap ' +
        VARIANTS[variant] + ' ' + SIZES[size] + (className ? ' ' + className : '')
      }
    >
      {label}
    </span>
  )
}

/**
 * StatusBadge — adapter that maps a free-form `status` string to the
 * canonical Badge variants. Centralises status-string → visual mapping
 * so individual feature components don't need their own STATUS_COLOR
 * lookup tables (jobs/captured, estimates, variations all had their own
 * before this consolidation).
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    // Calls / messaging
    completed:   { label: 'Answered',  variant: 'success' },
    no_answer:   { label: 'Missed',    variant: 'warning' },
    voicemail:   { label: 'Voicemail', variant: 'info' },
    busy:        { label: 'Busy',      variant: 'danger' },
    failed:      { label: 'Failed',    variant: 'danger' },
    // Subscription
    active:      { label: 'Active',    variant: 'success' },
    trial:       { label: 'Trial',     variant: 'info' },
    paused:      { label: 'Paused',    variant: 'warning' },
    cancelled:   { label: 'Cancelled', variant: 'neutral' },
    // Connections / integrations
    connected:   { label: 'Connected',    variant: 'success' },
    disconnected:{ label: 'Disconnected', variant: 'neutral' },
    // Generic
    pending:     { label: 'Pending',   variant: 'neutral' },
    offline:     { label: 'Offline',   variant: 'neutral' },
    online:      { label: 'Online',    variant: 'success' },
    // Estimates / variations / jobs lifecycle (added so feature components
    // can drop their local STATUS_COLOR maps in favour of <StatusBadge>)
    draft:       { label: 'Draft',     variant: 'neutral' },
    sent:        { label: 'Sent',      variant: 'info' },
    viewed:      { label: 'Viewed',    variant: 'info' },
    accepted:    { label: 'Accepted',  variant: 'success' },
    won:         { label: 'Won',       variant: 'success' },
    lost:        { label: 'Lost',      variant: 'neutral' },
    rejected:    { label: 'Rejected',  variant: 'danger' },
    approved:    { label: 'Approved',  variant: 'success' },
    invoiced:    { label: 'Invoiced',  variant: 'success' },
    expired:     { label: 'Expired',   variant: 'neutral' },
    // Job-capture lifecycle
    captured:    { label: 'Captured',  variant: 'info' },
    estimated:   { label: 'Estimated', variant: 'info' },
    booked:      { label: 'Booked',    variant: 'success' },
    quoted:      { label: 'Quoted',    variant: 'info' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge label={label} variant={variant} className={className} />
}

/**
 * DirectionBadge — inbound vs outbound. Used in the calls table and
 * activity feed. Direction has nothing to do with success/danger; both
 * directions render in muted neutral so the row text/colour is reserved
 * for the actual outcome (answered / missed / voicemail).
 */
export function DirectionBadge({ direction, className }: { direction: string; className?: string }) {
  return (
    <Badge
      label={direction === 'inbound' ? 'In' : 'Out'}
      variant="neutral"
      className={className}
    />
  )
}
