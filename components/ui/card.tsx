import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Card — v2.
 *
 * Two variants:
 * - `default`  → 8px radius, 1px hairline border, 20px padding,
 *                bg-card. The chrome of every page.
 * - `hero`     → same shell + a 2px accent strip on the left edge.
 *                Reserved for elements that MUST draw the eye:
 *                `HeroRoiCard`, `PlanUpgradePanel`, `AgentStatusCard`.
 *                Replaces every old `bg-gradient-to-br` panel.
 *
 * Density:
 * - `compact`  → 12px padding (used in dense table headers / chips)
 * - `default`  → 16px padding (used everywhere)
 * - `roomy`    → 24px padding (used on settings forms / billing rows)
 *
 * Backwards-compatible:
 * - The legacy `padding` prop ('sm' | 'md' | 'lg') still works and maps
 *   to the new `density` scale. ~225 ad-hoc `rounded-xl border bg-card`
 *   div patterns in the codebase will collapse to 8px via the global
 *   radius cap (see globals.css `@theme inline`); we don't have to touch
 *   them all immediately.
 */

type Density = 'compact' | 'default' | 'roomy'
type Variant = 'default' | 'hero'
type LegacyPadding = 'sm' | 'md' | 'lg'

interface CardProps {
  children: ReactNode
  className?: string
  /** Modern API — semantic density */
  density?: Density
  /** Modern API — hero variant adds a 2px accent strip */
  variant?: Variant
  /** Legacy API — kept so existing pages keep working until migrated */
  padding?: LegacyPadding
  /** Optional href makes the entire card a focusable, clickable link */
  asLink?: string
}

const DENSITY: Record<Density, string> = {
  compact: 'p-3',
  default: 'p-4 sm:p-5',
  roomy:   'p-6 sm:p-8',
}

const LEGACY_PADDING: Record<LegacyPadding, Density> = {
  sm: 'compact',
  md: 'default',
  lg: 'roomy',
}

export function Card({
  children,
  className,
  density,
  variant = 'default',
  padding,
  asLink,
}: CardProps) {
  // Resolve density: explicit `density` wins, else fall back to legacy
  // `padding` mapping, else the new default (which is tighter than the
  // old default — 16-20px instead of 20-24px).
  const resolvedDensity: Density =
    density ?? (padding ? LEGACY_PADDING[padding] : 'default')

  const base = cn(
    // 8px radius via the capped scale. `rounded-lg` resolves to
    // `--radius-lg = 0.5rem` per @theme inline.
    'rounded-lg',
    // 1px hairline. `border-border` resolves to OKLCH alpha-channel
    // border so it rides any background.
    'border border-border',
    // Surface — slightly elevated above page bg.
    'bg-card text-card-foreground',
    // Density.
    DENSITY[resolvedDensity],
    // Hero variant — left-edge accent strip via inset box-shadow so we
    // don't add real shadow, just a 2px vertical line of `--primary`.
    variant === 'hero' && 'shadow-[inset_2px_0_0_0_var(--primary)]',
    // Hover affordance only for clickable cards.
    asLink && 'transition-colors hover:bg-muted/40',
    className,
  )

  if (asLink) {
    return (
      <a href={asLink} className={cn(base, 'block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
        {children}
      </a>
    )
  }

  return <div className={base}>{children}</div>
}

interface SectionProps {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
  className?: string
  /** Inherits Card's variant — useful when a Section IS a hero panel */
  variant?: Variant
  density?: Density
}

/**
 * Section — Card with a title row.
 *
 * Used heavily in /settings/* pages (38+ callsites). The new layout:
 * - title is `text-base font-semibold` (was unchanged)
 * - description is `text-sm text-muted-foreground`
 * - title row gets a hairline divider below it (visual grouping cue)
 * - action slot is right-aligned, vertically centred to the title
 *
 * No corner-radius differences between Section and Card — both are 8px.
 */
export function Section({
  title,
  description,
  children,
  action,
  className,
  variant,
  density,
}: SectionProps) {
  return (
    <Card className={className} variant={variant} density={density}>
      <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-border">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground tracking-tight">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground mt-1 leading-snug">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </Card>
  )
}

// Earlier draft exported CardHeader / CardTitle / CardDescription /
// CardContent / CardFooter "for shadcn-compatibility". Zero callsites in
// the repo. Removed — dead-code surface and confusion ("which API do I use?")
// is worse than the optionality. <Section> + raw divs cover every callsite.
