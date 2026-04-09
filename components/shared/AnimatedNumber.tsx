'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedNumberProps {
  target: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}

export default function AnimatedNumber({
  target,
  prefix = '',
  suffix = '',
  duration = 1200,
  className = '',
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === 0) { setDisplay(0); return }
    startRef.current = null

    function step(ts: number) {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplay(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return (
    <span className={className}>
      {prefix}{display.toLocaleString('en-GB')}{suffix}
    </span>
  )
}
