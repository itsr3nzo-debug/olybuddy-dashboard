'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatCurrency } from '@/lib/format'
import { motion } from 'motion/react'

interface OpportunityDonutProps {
  openCount: number
  wonCount: number
  lostCount: number
  totalValue: number
}

export default function OpportunityDonut({ openCount, wonCount, lostCount, totalValue }: OpportunityDonutProps) {
  const total = openCount + wonCount + lostCount
  if (total === 0) return null

  const data = [
    { name: 'Open', value: openCount, color: '#6366f1' },
    { name: 'Won', value: wonCount, color: '#22c55e' },
    { name: 'Lost', value: lostCount, color: '#ef4444' },
  ].filter(d => d.value > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-xl border p-5 bg-card mb-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Pipeline Overview</h3>
      <div className="flex items-center gap-6">
        <div className="w-28 h-28 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={32} outerRadius={50} paddingAngle={2} dataKey="value" stroke="none">
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                formatter={(v) => [String(v), '']}
                contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-foreground">{total}</span>
            <span className="text-[9px] text-muted-foreground">deals</span>
          </div>
        </div>
        <div className="space-y-2">
          {data.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
              <span className="text-sm text-foreground">{d.name}: {d.value}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-border">
            <span className="text-xs text-muted-foreground">Total value: </span>
            <span className="text-sm font-bold text-brand-success">{formatCurrency(totalValue)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
