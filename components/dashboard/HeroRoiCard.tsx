'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import { TrendingUp, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HeroRoiCardProps {
  savedPounds: number
  /**
   * Optional 28-point sparkline data. When provided, renders behind the
   * hero number at low alpha — Vercel/Mercury pattern. The sparkline is
   * pure decoration: it's never the data point the user reads, only the
   * trend texture beneath the headline number.
   */
  sparkline?: number[]
  /**
   * Optional breakdown driving the provenance row. Provenance shows the
   * customer EXACTLY where the £ figure came from — DA pass identified
   * this as critical: a £447 figure with no working-out reads like a
   * marketing claim, regardless of how typeset the number is. With the
   * breakdown, the same number reads like an audit trail.
   */
  breakdown?: {
    messages: number
    calls: number
    bookings: number
  }
  /**
   * Period label for the eyebrow ("this week", "last 30 days", etc.).
   * Defaults to "this week" for backwards-compat. DA flagged the previous
   * hardcoded "this week" lying when the user picked a 30/90 day period
   * upstream.
   */
  periodLabel?: string
}

/**
 * HeroRoiCard — v3.
 *
 * Visual layering:
 *   - Card: hairline border + 2px primary accent strip
 *   - Sparkline: rendered absolute, behind content, primary at 18% alpha
 *   - Number: foreground, mono tabular, tracking-[-0.04em] for display weight
 *   - Eyebrow + sub-stat: muted neutral
 *   - NEW: provenance row — hover/click "i" to expand the math behind
 *     the £ figure (Decagon-tier transparency, applied to the metric
 *     instead of the AI message)
 */

function HeroSparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null
  const w = 600
  const h = 80
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
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        // 18% alpha — sits behind without pulling focus
        style={{ opacity: 0.18 }}
      />
    </svg>
  )
}

export default function HeroRoiCard({ savedPounds, sparkline, breakdown, periodLabel = 'this week' }: HeroRoiCardProps) {
  const [provenanceOpen, setProvenanceOpen] = useState(false)

  if (savedPounds === 0) return null

  const messagesValue = (breakdown?.messages ?? 0) * 5
  const callsValue = (breakdown?.calls ?? 0) * 15
  const bookingsValue = (breakdown?.bookings ?? 0) * 50

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative overflow-hidden rounded-lg border border-border bg-card shadow-[inset_2px_0_0_0_var(--primary)] p-6 sm:p-8 mb-6"
      aria-label={`Money saved ${periodLabel}`}
    >
      {sparkline && <HeroSparkline data={sparkline} />}
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Eyebrow + provenance toggle */}
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Money saved {periodLabel}
            </p>
            {breakdown && (
              <button
                type="button"
                // DA fix: was onClick + onMouseEnter + onMouseLeave together —
                // on touch devices both fire and toggled weirdly. Now: click
                // to toggle on every device. Hover-to-peek removed (the icon
                // is small enough that drive-by hovers were misfiring).
                onClick={() => setProvenanceOpen((v) => !v)}
                aria-expanded={provenanceOpen}
                aria-label="Show how this number was calculated"
                className={cn(
                  'inline-flex items-center justify-center size-4 rounded-full',
                  'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'transition-colors',
                )}
              >
                <Info size={11} strokeWidth={1.75} />
              </button>
            )}
          </div>

          {/* Hero number — Mercury display */}
          <div className="mt-2 font-mono tabular-nums tracking-[-0.04em] text-foreground text-4xl sm:text-5xl lg:text-[56px] leading-none">
            <AnimatedNumber target={savedPounds} prefix="£" duration={1000} />
          </div>

          {/* Sub-stat — context line */}
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed max-w-md">
            vs hiring an admin assistant
            <span className="text-muted-foreground/70"> · messages £5 · calls £15 · bookings £50</span>
          </p>

          {/* Provenance row — the math, audit-trail style. Linear-pattern
              expand: hairline divider, mono breakdown, three lines max. */}
          <AnimatePresence initial={false}>
            {provenanceOpen && breakdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-4 pt-3 border-t border-border space-y-1 text-xs font-mono tabular-nums">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      <span className="text-foreground">{breakdown.messages.toLocaleString('en-GB')}</span> messages
                      <span className="text-muted-foreground/50"> × </span>
                      £5
                    </span>
                    <span className="text-foreground">£{messagesValue.toLocaleString('en-GB')}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      <span className="text-foreground">{breakdown.calls.toLocaleString('en-GB')}</span> calls answered
                      <span className="text-muted-foreground/50"> × </span>
                      £15
                    </span>
                    <span className="text-foreground">£{callsValue.toLocaleString('en-GB')}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      <span className="text-foreground">{breakdown.bookings.toLocaleString('en-GB')}</span> bookings made
                      <span className="text-muted-foreground/50"> × </span>
                      £50
                    </span>
                    <span className="text-foreground">£{bookingsValue.toLocaleString('en-GB')}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-border text-foreground font-medium">
                    <span>Total</span>
                    <span>£{savedPounds.toLocaleString('en-GB')}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Trending icon — restrained, no tile, no emoji */}
        <TrendingUp
          size={20}
          strokeWidth={1.5}
          className="text-muted-foreground/60 shrink-0 mt-1"
          aria-hidden
        />
      </div>
    </motion.section>
  )
}
