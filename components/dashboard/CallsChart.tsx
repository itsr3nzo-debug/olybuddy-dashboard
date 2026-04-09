'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface CallsChartProps {
  data: Array<{ date: string; calls: number }>
}

/** Recharts AreaChart — retained for React 19 compatibility. Tremor v3 pending React 19 support. */
export default function CallsChart({ data }: CallsChartProps) {
  return (
    <div className="rounded-xl p-5 border" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Call Volume — Last 7 Days
        </h2>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {data.reduce((s, d) => s + d.calls, 0)} total
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--foreground)',
            }}
            cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
            formatter={(v) => [`${v} call${v === 1 ? '' : 's'}`, '']}
          />
          <Area type="monotone" dataKey="calls" stroke="#6366f1" strokeWidth={2} fill="url(#callGrad)"
            dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#6366f1', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl p-5 border" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
      <div className="skeleton h-4 w-48 mb-4 rounded" />
      <div className="skeleton w-full rounded" style={{ height: 200 }} />
    </div>
  )
}
