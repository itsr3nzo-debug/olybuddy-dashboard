import * as React from 'react'
import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

/**
 * BannerShell — visual primitive shared by the three stateful banners
 * (TrialBanner, ProvisioningBanner, EmailVerificationBanner).
 *
 * Each stateful banner keeps its own polling / dismissal / rate-limit
 * logic but renders through this primitive so they look consistent.
 *
 * Visual design:
 * - 40px tall (px-4 py-2.5 with text-sm), single-line by default
 * - Hairline border + 2px accent strip on the left edge (matches
 *   `Card variant="hero"`)
 * - Intent-tinted: info (primary navy), warning (amber), danger (red)
 * - Icon → message → optional action button(s) → optional dismiss
 * - Sticky-stackable: stack three banners and they pile cleanly with
 *   shared border separation
 *
 * No backdrop-blur, no gradient, no shadow. The accent strip carries
 * the eye; nothing else needs to.
 *
 * Usage example (consumed by the existing stateful banner components):
 *
 *   <BannerShell
 *     intent="warning"
 *     icon={AlertTriangle}
 *     onDismiss={dismiss}
 *   >
 *     Trial ends in 3 days.
 *     <BannerAction href="/settings/billing">Add payment method</BannerAction>
 *   </BannerShell>
 */

export type BannerIntent = 'info' | 'warning' | 'danger' | 'success'

interface BannerShellProps {
  intent?: BannerIntent
  icon?: LucideIcon
  children: React.ReactNode
  onDismiss?: () => void
  className?: string
  /** Render as <button>-tappable wrapper if a click handler is provided */
  onClick?: () => void
}

// NB: strip + icon must read from THE SAME var so the colours match
// pixel-for-pixel. Earlier draft mixed `var(--brand-danger)` (legacy hex
// token) on the strip with `text-destructive` (oklch) on the icon — they
// were two different shades of red. Standardised on the legacy --brand-*
// hex tokens for both since they exist for all 4 intents and stay
// consistent across light/dark.
const INTENT_STYLES: Record<BannerIntent, { strip: string; icon: string }> = {
  info: {
    strip: 'shadow-[inset_2px_0_0_0_var(--brand-primary)]',
    icon: 'text-brand-primary',
  },
  warning: {
    strip: 'shadow-[inset_2px_0_0_0_var(--brand-warning)]',
    icon: 'text-brand-warning',
  },
  danger: {
    strip: 'shadow-[inset_2px_0_0_0_var(--brand-danger)]',
    icon: 'text-brand-danger',
  },
  success: {
    strip: 'shadow-[inset_2px_0_0_0_var(--brand-success)]',
    icon: 'text-brand-success',
  },
}

function BannerShellImpl({
  intent = 'info',
  icon: Icon,
  children,
  onDismiss,
  className,
  onClick,
}: BannerShellProps) {
  const style = INTENT_STYLES[intent]
  return (
    <div
      role="status"
      onClick={onClick}
      className={cn(
        // 8px radius via the capped scale
        'rounded-lg',
        // Hairline border + accent strip
        'border border-border',
        style.strip,
        // Surface
        'bg-card text-card-foreground',
        // Density — single-line by default, wraps if needed
        'flex items-start gap-3 px-4 py-2.5 text-sm',
        // Pointer feedback if clickable
        onClick && 'cursor-pointer hover:bg-muted/40 transition-colors',
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn('size-4 mt-0.5 shrink-0', style.icon)}
          strokeWidth={1.75}
        />
      )}
      <div className="flex-1 min-w-0 leading-snug text-foreground">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className={cn(
            'shrink-0 -mr-1 -mt-0.5 size-7 inline-flex items-center justify-center rounded-md',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'transition-colors',
          )}
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2L10 10M10 2L2 10" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * Memoised — banners poll every 20-30s and the children are stable JSX
 * references in the parent. Without memo, every poll cycle re-renders
 * the whole banner DOM tree.
 */
export const BannerShell = memo(BannerShellImpl)

/**
 * BannerAction — inline action button styled to fit on a banner row.
 *
 * Accepts either an href (renders <a>) or onClick (renders <button>).
 * Visually a small ghost-style chip — never a primary button (banners
 * shouldn't compete with the page's main CTA).
 */
export function BannerAction({
  href,
  onClick,
  children,
  className,
  intent = 'info',
}: {
  href?: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
  intent?: BannerIntent
}) {
  const tint = {
    info: 'text-primary hover:bg-primary/10 border-primary/30 hover:border-primary/50',
    warning: 'text-warning hover:bg-warning/10 border-warning/30 hover:border-warning/50',
    danger: 'text-destructive hover:bg-destructive/10 border-destructive/30 hover:border-destructive/50',
    success: 'text-success hover:bg-success/10 border-success/30 hover:border-success/50',
  }[intent]

  const cls = cn(
    'inline-flex items-center gap-1.5 ml-2',
    'h-6 px-2.5 text-xs font-medium rounded-sm border',
    'transition-colors whitespace-nowrap',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    tint,
    className,
  )

  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  )
}
