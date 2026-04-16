'use client'

import { useRouter } from 'next/navigation'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface SentimentDonutProps {
  positive: number
  neutral: number
  negative: number
}

const COLORS = {
  positive: '#22c55e',
  neutral: '#64748b',
  negative: '#ef4444',
}

export default function SentimentDonut({ positive, neutral, negative }: SentimentDonutProps) {
  const router = useRouter()
  const total = positive + neutral + negative

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Sentiment data will appear after calls are processed.</p>
  }

  const data = [
    { name: 'Positive', value: positive, color: COLORS.positive },
    { name: 'Neutral', value: neutral, color: COLORS.neutral },
    { name: 'Negative', value: negative, color: COLORS.negative },
  ].filter(d => d.value > 0)

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="w-40 h-40 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={70}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              onClick={(_, index) => {
                const sentiment = data[index]?.name?.toLowerCase()
                if (sentiment) router.push(`/calls?sentiment=${sentiment}`)
              }}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [`${value} (${Math.round(Number(value) / total * 100)}%)`, '']}
              contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-foreground">{total}</span>
          <span className="text-xs text-muted-foreground">calls</span>
        </div>
      </div>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
            <span className="text-sm text-foreground">{d.name}</span>
            <span className="text-sm text-muted-foreground">
              {d.value} ({Math.round(d.value / total * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
