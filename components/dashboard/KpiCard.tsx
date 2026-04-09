'use client'

import { useEffect, useRef, useState } from 'react'

interface KpiCardProps {
  label: string
  value: number | string
  sub?: string
  color?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  icon?: React.ReactNode
  trend?: number   // e.g. +12 = "↑ 12% vs last week", -5 = "↓ 5%"
  prefix?: string  // e.g. "£"
  animate?: boolean
}

const colorMap: Record<string, string> = {
  default: 'var(--foreground)',
  accent:  'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger:  'var(--danger)',
}

function AnimatedNumber({ target, prefix = '' }: { target: number; prefix?: string }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number>(0)
  const startRef = useRef<number | null>(null)
  const DURATION = 1200

  useEffect(() => {
    if (target === 0) { setDisplay(0); return }
    startRef.current = null
    function step(ts: number) {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const progress = Math.min(elapsed / DURATION, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setDisplay(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  return <>{prefix}{display.toLocaleString('en-GB')}</>
}

export default function KpiCard({ label, value, sub, color = 'default', icon, trend, prefix = '', animate = false }: KpiCardProps) {
  const c = colorMap[color] ?? colorMap.default
  const isNumeric = typeof value === 'number' && animate

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          {label}
        </span>
        {icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${c}20`, color: c }}>
            {icon}
          </div>
        )}
      </div>

      <div className="text-3xl font-bold leading-none" style={{ color: c }}>
        {isNumeric
          ? <AnimatedNumber target={value as number} prefix={prefix} />
          : <>{prefix}{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</>
        }
      </div>

      <div className="flex items-center justify-between min-h-[16px]">
        {sub && <span className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</span>}
        {trend !== undefined && (
          <span className="text-xs font-semibold" style={{ color: trend >= 0 ? 'var(--success)' : 'var(--danger)' }}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last week
          </span>
        )}
      </div>
    </div>
  )
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-8 rounded-lg" />
      </div>
      <div className="skeleton h-9 w-20" />
      <div className="skeleton h-3 w-32" />
    </div>
  )
}
