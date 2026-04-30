import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { isValidElement, type ReactNode } from 'react'

interface EmptyStateProps {
  /**
   * Either a Lucide icon component (preferred — passed as `Icon`, not
   * `<Icon />`) or any ReactNode (legacy — for callsites still passing
   * pre-rendered `<Icon className="size-6" />`).
   */
  icon?: LucideIcon | ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  /** Compact variant — for empty tables / small drawers (smaller icon, less padding) */
  compact?: boolean
}

/**
 * EmptyState — v2.
 *
 * Premium empty-state pattern (Linear / Notion / Stripe):
 * - Single monochrome line illustration (Lucide outlined icon at
 *   `text-muted-foreground` colour, 1.5px stroke). No filled circle
 *   bg behind the icon — that's the AI-tell pattern.
 * - One sentence of utility copy. Never marketing copy ("Welcome!",
 *   "Let's get started!").
 * - One CTA. If you have two CTAs, you don't have an empty state — you
 *   have a settings panel disguised as one.
 *
 * The previous version wrapped the icon in a 48×48 rounded-xl muted bg
 * tile. Stripped — just the icon, breathing in whitespace.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  // Accept both APIs:
  //   <EmptyState icon={Inbox} ... />              ← preferred (Lucide component)
  //   <EmptyState icon={<Inbox className="…" />} … /> ← legacy (pre-rendered JSX)
  const renderedIcon = (() => {
    if (!icon) return null
    if (isValidElement(icon)) return icon
    const Icon = icon as LucideIcon
    return (
      <Icon
        aria-hidden
        className={cn('text-muted-foreground/60', compact ? 'size-6' : 'size-8')}
        strokeWidth={1.5}
      />
    )
  })()

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className,
      )}
    >
      {renderedIcon && (
        <div className={cn('text-muted-foreground/60', compact ? 'mb-3' : 'mb-4')}>
          {renderedIcon}
        </div>
      )}
      <h3 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-base')}>
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-1.5 max-w-sm text-muted-foreground leading-relaxed',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      )}
      {action && <div className={cn(compact ? 'mt-3' : 'mt-5')}>{action}</div>}
    </div>
  )
}
