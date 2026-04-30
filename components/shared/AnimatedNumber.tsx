'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  target: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
  /**
   * When true (default), the unit prefix/suffix renders smaller and dimmer
   * than the digits — Mercury-style "the number is the protagonist". Set
   * to false if you need the prefix/suffix at full intensity (e.g. an
   * inline figure in body prose).
   */
  unitDimmed?: boolean
}

/**
 * AnimatedNumber — v2.
 *
 * Always renders in mono tabular-nums by default — wherever this gets
 * embedded (HeroRoiCard, KpiCard, money page hero, etc.) the digits will
 * align in their column without any caller-side `font-mono tabular-nums`
 * boilerplate. Override via `className` if explicitly needed.
 *
 * Mercury treatment for the prefix/suffix: the unit (£, %, $, "calls")
 * renders 60% the size and at 60% opacity of the digits, so the digits
 * carry the visual weight. This single touch makes the dashboard feel
 * "considered" instead of "default-Inter".
 *
 * Behaviour unchanged: ease-out cubic count-up, target=0 short-circuits.
 */
export default function AnimatedNumber({
  target,
  prefix = '',
  suffix = '',
  duration = 1200,
  className = '',
  unitDimmed = true,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === 0) {
      setDisplay(0)
      return
    }
    startRef.current = null

    function step(ts: number) {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  const unitClass = unitDimmed
    ? 'text-[0.6em] text-muted-foreground/60 align-baseline mr-[0.1em]'
    : ''
  const unitClassSuffix = unitDimmed
    ? 'text-[0.6em] text-muted-foreground/60 align-baseline ml-[0.1em]'
    : ''

  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {prefix && <span className={unitClass}>{prefix}</span>}
      {display.toLocaleString('en-GB')}
      {suffix && <span className={unitClassSuffix}>{suffix}</span>}
    </span>
  )
}
