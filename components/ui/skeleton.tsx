import { cn } from '@/lib/utils'

/**
 * Skeleton — v2.
 *
 * The point of a skeleton (vs a spinner): "your content is on the way
 * and it'll look like this." Premium dashboards (Stripe / Linear /
 * Notion) all use content-shaped skeletons that pulse — never spinners
 * inside the dashboard chrome.
 *
 * Three flavours:
 *   <Skeleton />              default rectangle, 12px tall
 *   <Skeleton className="h-8 w-32" />   custom dimensions
 *   <Skeleton.Text lines={3} />          paragraph skeleton
 *   <Skeleton.Row />                     full-width 36px row (table cell)
 *
 * Animation: just `animate-pulse` (Tailwind built-in). Earlier draft also
 * added the legacy `.skeleton` class which has its own shimmer keyframes
 * in globals.css — applying both produced a doubled animation cycle and
 * the shimmer pattern washed out the pulse. Single animation only.
 */

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'rect' | 'text' | 'circle'
}

// NB: not memoised — Skeleton only renders during Suspense loading states,
// not in hot realtime paths. memo() here would be net-negative (memo cache
// overhead vs. zero re-renders to skip).
function SkeletonBase({ className, variant = 'rect', ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'animate-pulse bg-muted/60',
        variant === 'circle' ? 'rounded-full' : 'rounded-sm',
        // Default sizing if not overridden
        variant === 'text' && !className?.includes('h-') && 'h-3.5',
        variant === 'rect' && !className?.includes('h-') && 'h-3',
        className,
      )}
      {...props}
    />
  )
}

export const Skeleton = SkeletonBase as typeof SkeletonBase & {
  Text: typeof SkeletonText
  Row: typeof SkeletonRow
  Card: typeof SkeletonCard
}

interface SkeletonTextProps {
  /** Number of text lines to render */
  lines?: number
  className?: string
}

function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          // Last line is shorter — feels like real prose
          className={i === lines - 1 ? 'w-3/5' : 'w-full'}
        />
      ))}
    </div>
  )
}

function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0',
        className,
      )}
    >
      <Skeleton variant="circle" className="size-6 shrink-0" />
      <Skeleton variant="text" className="w-1/3" />
      <Skeleton variant="text" className="w-1/4 ml-auto" />
    </div>
  )
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-5 space-y-3', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <SkeletonText lines={2} />
    </div>
  )
}

Skeleton.Text = SkeletonText
Skeleton.Row  = SkeletonRow
Skeleton.Card = SkeletonCard
