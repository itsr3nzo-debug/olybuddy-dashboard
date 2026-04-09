'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'

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

const colorMap: Record<string, { css: string; hex: string; glow: string }> = {
  default: { css: 'var(--foreground)',     hex: '#64748b', glow: 'rgba(100,116,139,0.1)' },
  accent:  { css: 'var(--brand-primary)',  hex: '#6366f1', glow: 'rgba(99,102,241,0.1)' },
  success: { css: 'var(--brand-success)',  hex: '#22c55e', glow: 'rgba(34,197,94,0.1)' },
  warning: { css: 'var(--brand-warning)',  hex: '#f59e0b', glow: 'rgba(245,158,11,0.1)' },
  danger:  { css: 'var(--brand-danger)',   hex: '#ef4444', glow: 'rgba(239,68,68,0.1)' },
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
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * target))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target])

  return <>{prefix}{display.toLocaleString('en-GB')}</>
}

export default function KpiCard({ label, value, sub, color = 'default', icon, trend, prefix = '', animate = false, sparklineData, index = 0 }: KpiCardProps) {
  const { css: c, hex, glow } = colorMap[color] ?? colorMap.default
  const isNumeric = typeof value === 'number' && animate
  const sparkData = sparklineData?.map((v, i) => ({ i, v }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="group relative rounded-2xl border p-4 sm:p-5 flex flex-col gap-2 transition-all duration-300 hover:shadow-lg bg-card dark:bg-card overflow-hidden"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Subtle gradient glow on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl"
        style={{ background: `radial-gradient(circle at 50% 0%, ${glow}, transparent 70%)` }}
      />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {icon && (
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
              style={{ background: `${hex}15`, color: c }}
            >
              {icon}
            </div>
          )}
        </div>

        <div className="text-[28px] sm:text-[36px] font-bold leading-none tracking-tight" style={{ color: c }}>
          {isNumeric
            ? <AnimatedNumber target={value as number} prefix={prefix} />
            : <>{prefix}{typeof value === 'number' ? value.toLocaleString('en-GB') : value}</>
          }
        </div>

        {sparkData && sparkData.length > 1 && (
          <div className="h-10 mt-1 -mx-1 opacity-60 group-hover:opacity-100 transition-opacity">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <defs>
                  <linearGradient id={`spark-${color}-${index}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={hex} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={hex} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <Line type="monotone" dataKey="v" stroke={`url(#spark-${color}-${index})`} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="flex items-center justify-between mt-1.5 min-h-[18px]">
          {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
          {trend !== undefined && (
            <motion.span
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.6 + index * 0.08 }}
              className={`text-[11px] font-bold ${trend >= 0 ? 'text-brand-success' : 'text-brand-danger'}`}
            >
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </motion.span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-2xl border p-4 sm:p-5 flex flex-col gap-2 bg-card" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-9 w-9 rounded-xl" />
      </div>
      <div className="skeleton h-10 w-24 rounded" />
      <div className="skeleton h-10 w-full rounded" />
      <div className="skeleton h-3 w-28 rounded" />
    </div>
  )
}
