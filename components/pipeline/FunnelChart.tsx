'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { PIPELINE_STAGES } from '@/lib/constants'
import { formatCurrency } from '@/lib/format'

interface FunnelChartProps {
  stageData: Array<{ stage: string; count: number; value: number }>
}

export default function FunnelChart({ stageData }: FunnelChartProps) {
  const firstCount = stageData[0]?.count ?? 1

  const allStages = PIPELINE_STAGES
    .filter(s => s.key !== 'lost')
    .map(s => {
      const d = stageData.find(sd => sd.stage === s.key)
      const count = d?.count ?? 0
      const value = d?.value ?? 0
      const convPct = firstCount > 0 ? Math.round((count / firstCount) * 100) : 0
      return { name: s.label, count, value, convPct, hex: s.hex }
    })

  const data = allStages.filter(d => d.count > 0)

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Funnel data will appear as opportunities progress through stages.</p>
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(data.length * 45, 120)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            formatter={(v) => [`${v} deals`, '']}
          />
          <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={24}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.hex} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {data.filter(d => d.count > 0).map(d => (
          <span key={d.name} className="text-[10px] text-muted-foreground">
            {d.name}: {d.count} ({d.convPct}%) · {formatCurrency(d.value)}
          </span>
        ))}
      </div>
    </div>
  )
}
