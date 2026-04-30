'use client'

import AnimatedNumber from '@/components/shared/AnimatedNumber'

interface HeroSavedProps {
  savedPence: number
  roi: number
  memberSince: string
}

/**
 * HeroSaved — v2.
 *
 * Was: a 3-stop WhatsApp-green gradient (`var(--hero-gradient)`) with white
 * text and a pill chip floating on `bg-white/20`. The gradient + white-text
 * combo is the canonical AI-marketing-hero look. Read as cheap.
 *
 * Now: hairline-bordered card + 2px primary accent strip on the left edge.
 * The number itself is the visual focus — Mercury-style:
 *   - Mono tabular figures
 *   - 56-72px display size
 *   - £ symbol smaller and dimmer than the digits
 *   - tracking-tight to feel typeset
 *
 * The ROI pill stays but uses the success token for the ratio rather than
 * sitting on a transparent white bg.
 */
export default function HeroSaved({ savedPence, roi, memberSince }: HeroSavedProps) {
  const pounds = Math.round(savedPence / 100)

  return (
    <section
      className="relative overflow-hidden rounded-lg border border-border bg-card shadow-[inset_2px_0_0_0_var(--primary)] p-6 sm:p-8 mb-6"
      aria-label="Money saved by your AI Employee"
    >
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Your AI Employee has saved you
        </p>
        <div
          className="mt-3 font-mono tabular-nums tracking-tight text-foreground leading-none flex items-baseline justify-center gap-1"
          style={{ fontSize: 'clamp(2.5rem, 9vw, 4.5rem)' }}
        >
          {/* £ symbol smaller + dimmer than digits — Mercury pattern */}
          <span className="text-muted-foreground/60" style={{ fontSize: '0.6em' }}>£</span>
          <AnimatedNumber target={pounds} duration={1200} />
        </div>

        {memberSince && (
          <p className="mt-3 text-sm text-muted-foreground">
            since you joined Nexley AI
          </p>
        )}

        {roi > 1 && (
          <div className="inline-flex items-center gap-1.5 mt-5 px-3 h-7 rounded-sm border border-success/30 bg-success/10 text-success text-xs font-medium">
            <span className="font-mono tabular-nums">£{roi}</span>
            <span>returned for every £1 spent</span>
          </div>
        )}
      </div>
    </section>
  )
}
