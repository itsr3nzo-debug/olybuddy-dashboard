'use client'

import { motion } from 'motion/react'
import { ArrowUp, ArrowDown, Clock } from 'lucide-react'

interface PeriodStats {
  resolutionRate: number
  callsHandled: number
  positiveRate: number
  avgDuration: number
}

interface BeforeAfterCardProps {
  first30: PeriodStats
  current30: PeriodStats
  hasEnoughData: boolean
}

function MetricRow({ label, before, after, suffix = '', higherIsBetter = true }: {
  label: string; before: number; after: number; suffix?: string; higherIsBetter?: boolean
}) {
  const delta = before > 0 ? Math.round(((after - before) / before) * 100) : 0
  const isImproved = higherIsBetter ? after > before : after < before

  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground/60 w-16 text-right">{before}{suffix}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className="text-sm font-semibold text-foreground w-16 text-right">{after}{suffix}</span>
        {delta !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs font-bold ${isImproved ? 'text-brand-success' : 'text-brand-danger'}`}>
            {isImproved ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  )
}

export default function BeforeAfterCard({ first30, current30, hasEnoughData }: BeforeAfterCardProps) {
  if (!hasEnoughData) {
    return (
      <div className="rounded-xl border p-6 bg-card">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Before vs After</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          This comparison will appear after 60 days of use. Keep going!
        </p>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border p-6 bg-card"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Before vs After</h3>
        <div className="flex gap-4 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          <span>First 30 days</span>
          <span>Current 30 days</span>
        </div>
      </div>

      <MetricRow label="Resolution Rate" before={first30.resolutionRate} after={current30.resolutionRate} suffix="%" />
      <MetricRow label="Conversations" before={first30.callsHandled} after={current30.callsHandled} />
      <MetricRow label="Positive Sentiment" before={first30.positiveRate} after={current30.positiveRate} suffix="%" />
      <MetricRow label="Avg Duration" before={first30.avgDuration} after={current30.avgDuration} suffix="s" higherIsBetter={false} />
    </motion.div>
  )
}
