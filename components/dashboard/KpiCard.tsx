'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: number | string
  sub?: string
  color?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  icon?: React.ReactNode
  trend?: number
  prefix?: string
  animate?: boolean
  sparklineData?: number[]
  index?: number
}

/**
 * KpiCard — v2.
 *
 * Stripped of:
 * - rounded-2xl → 8px (radius cap auto-applies but we set rounded-lg
 *   explicitly for clarity)
 * - Coloured icon tile bg (was `${hex}15` background) → drops the tile
 *   entirely; icon floats inline with label, in muted colour
 * - Hover gradient glow → flat hover state (subtle bg shift only)
 * - Big coloured number (`color: c`) → numbers stay foreground colour;
 *   only the trend pill carries semantic colour
 * - 28-36px font → 24-32px is enough for kpi cards (hero number is
 *   reserved for HeroRoiCard)
 *
 * Preserved:
 * - AnimatedNumber count-up (kept inline)
 * - Sparkline (kept, but stroke 1.5 in muted-foreground for default,
 *   primary for accent)
 * - Trend up/down indicator
 * - Stagger animation entrance
 */

const SPARK_STROKE: Record<string, string> = {
  default: 'var(--muted-foreground)',
  accent:  'var(--primary)',
  success: 'var(--brand-success)',
  warning: 'var(--brand-warning)',
  danger:  'var(--brand-danger)',
}

/**
 * Inline SVG sparkline — replaces the recharts LineChart that previously
 * lived here. recharts is ~200kB minified and the dashboard ships 4
 * KpiCards on every render, so this single swap removes recharts from
 * the dashboard's initial bundle entirely (CallsChart is the only other
 * recharts consumer on this route, lazy-loaded via next/dynamic).
 *
 * The sparkline draws a single 1.5px polyline through the data points,
 * scaled to fit the SVG viewBox. No fill, no gradient, no dots — Linear /
 * Vercel pattern.
 */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null
  const w = 100
  const h = 24
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const stepX = w / (data.length - 1)
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="w-full h-8"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function AnimatedNumber({ target, prefix = '' }: { target: number; prefix?: string }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number | null>(null)
  const DURATION = 1000

  useEffect(() => {
    if (target === 0) {
      setDisplay(0)
      return
    }
    startRef.current = null
    function step(ts: number) {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / DURATION, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  return (
    <>
      {prefix}
      {display.toLocaleString('en-GB')}
    </>
  )
}

function KpiCardImpl({
  label,
  value,
  sub,
  color = 'default',
  icon,
  trend,
  prefix = '',
  animate = false,
  sparklineData,
  index = 0,
}: KpiCardProps) {
  const isNumeric = typeof value === 'number' && animate
  const sparkColor = SPARK_STROKE[color] ?? SPARK_STROKE.default

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.05,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={cn(
        'group relative rounded-lg border border-border bg-card',
        'p-4 flex flex-col gap-2',
        'transition-colors duration-200',
        'hover:bg-muted/30',
      )}
    >
      {/* Top row — small-caps label + optional inline icon */}
      <div className="flex items-center justify-between gap-2 min-h-[20px]">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
        {icon && <span className="text-muted-foreground/60 shrink-0">{icon}</span>}
      </div>

      {/* Value — neutral foreground, mono tabular */}
      <div className="font-mono tabular-nums text-2xl sm:text-[28px] font-semibold leading-none tracking-tight text-foreground">
        {isNumeric ? (
          <AnimatedNumber target={value as number} prefix={prefix} />
        ) : (
          <>
            {prefix}
            {typeof value === 'number' ? value.toLocaleString('en-GB') : value}
          </>
        )}
      </div>

      {/* Sparkline — inline SVG, no recharts. Replaces a 200kB dependency
          for KpiCard's tiny 100×24 line render. */}
      {sparklineData && sparklineData.length > 1 && (
        <div className="mt-1 -mx-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <Sparkline data={sparklineData} color={sparkColor} />
        </div>
      )}

      {/* Bottom row — sub + trend */}
      <div className="flex items-center justify-between mt-0.5 min-h-[16px]">
        {sub && (
          <span className="text-[11px] text-muted-foreground truncate">{sub}</span>
        )}
        {trend !== undefined && (
          <span
            className={cn(
              'text-[11px] font-mono tabular-nums shrink-0',
              trend >= 0 ? 'text-success' : 'text-destructive',
            )}
          >
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Memoised — props are mostly primitives. Re-renders only when label /
 * value / trend actually change. Dashboard renders 4 KpiCards in a row
 * and re-renders on every realtime tick; memo is a real win here.
 */
const KpiCard = memo(KpiCardImpl)
export default KpiCard

export function KpiCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
      <div className="skeleton h-3 w-20 rounded" />
      <div className="skeleton h-7 w-20 rounded" />
      <div className="skeleton h-8 w-full rounded" />
      <div className="skeleton h-3 w-24 rounded" />
    </div>
  )
}
