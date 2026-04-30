import { memo } from 'react'
import { cn } from '@/lib/utils'

/**
 * StatusDot — single canonical indicator for "is the agent / VPS / call /
 * integration / WhatsApp pairing alive?". Replaces the assorted pulsing
 * dots scattered across the codebase (`VpsHeartbeatBadge`, inline
 * `bg-emerald-500 rounded-full` divs, etc).
 *
 * Five canonical statuses:
 *   online   — solid `--primary` (navy) dot, no animation. The default
 *              "everything healthy" state. (Not green — green is reserved
 *              for monetary success only.)
 *   live     — solid green `success` with pulse. For "ACTIVE NOW" (call
 *              in progress, agent typing, sub: trial+vps_ready).
 *   warming  — solid amber `warning` with pulse. For provisioning, OAuth
 *              re-auth in progress, trial expiring soon.
 *   offline  — outlined dot (no fill), `muted-foreground` colour. For
 *              "not paired yet", "no data", "service stopped".
 *   error    — solid red `danger`, no animation. For "down", "rejected",
 *              "payment failed".
 *
 * Sizes: 6 / 8 / 10px — pick by context (sidebar item / inline label /
 * hero card respectively).
 *
 * The component never renders a label — pair it with text in the parent
 * so screenreaders get full context.
 */

type Status = 'online' | 'live' | 'warming' | 'offline' | 'error'
type Size = 'sm' | 'default' | 'lg'

interface StatusDotProps {
  status: Status
  size?: Size
  className?: string
  /** Aria-label override; default = the status name */
  label?: string
}

const SIZE_PX: Record<Size, string> = {
  sm: 'size-1.5',       // 6px
  default: 'size-2',    // 8px
  lg: 'size-2.5',       // 10px
}

function StatusDotImpl({ status, size = 'default', className, label }: StatusDotProps) {
  const dim = SIZE_PX[size]

  // Outer wrapper handles the optional pulse-ring (live / warming).
  // Inner dot is the actual pixel of colour.
  const dotBase = cn('inline-block rounded-full', dim)

  const ringPulse = status === 'live' || status === 'warming'

  let dotClasses = ''
  let ringClasses = ''

  switch (status) {
    case 'online':
      dotClasses = 'bg-primary'
      break
    case 'live':
      dotClasses = 'bg-success'
      ringClasses = 'bg-success/30'
      break
    case 'warming':
      dotClasses = 'bg-warning'
      ringClasses = 'bg-warning/30'
      break
    case 'offline':
      // Outlined-only — 1px ring instead of fill.
      dotClasses = 'border border-muted-foreground bg-transparent'
      break
    case 'error':
      dotClasses = 'bg-destructive'
      break
  }

  return (
    <span
      role="status"
      aria-label={label ?? status}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
    >
      {ringPulse && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 rounded-full animate-ping',
            ringClasses,
            // Rings expand visually beyond the dot
            size === 'sm' ? 'size-2' : size === 'lg' ? 'size-3.5' : 'size-3',
          )}
        />
      )}
      <span aria-hidden className={cn(dotBase, dotClasses)} />
    </span>
  )
}

/**
 * Memoised — primitive props, called from sidebar header (every render),
 * agent status card, dashboard activity feed rows, fleet table cells, and
 * VpsHeartbeatBadge. Re-rendering it 8+ times on every realtime tick was
 * pure waste.
 */
export const StatusDot = memo(StatusDotImpl)
