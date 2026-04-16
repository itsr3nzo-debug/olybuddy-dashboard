'use client'

import { useRouter } from 'next/navigation'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface CallsChartProps {
  data: Array<{ date: string; calls: number }>
}

export default function CallsChart({ data }: CallsChartProps) {
  const router = useRouter()
  const total = data.reduce((s, d) => s + d.calls, 0)
  const peak = data.reduce((max, d) => d.calls > max.calls ? d : max, data[0])

  return (
    <div className="rounded-xl p-4 sm:p-5 border bg-card-bg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Activity — Last 7 Days</h2>
          {peak && peak.calls > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">Peak: {peak.date} ({peak.calls} calls)</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{total} total</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--brand-primary)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--brand-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--foreground)',
            }}
            cursor={{ stroke: 'var(--brand-primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
            formatter={(v) => [`${v} call${v === 1 ? '' : 's'}`, '']}
          />
          <Area
            type="monotone"
            dataKey="calls"
            stroke="var(--brand-primary)"
            strokeWidth={2}
            fill="url(#callGrad)"
            dot={{ r: 3, fill: 'var(--brand-primary)', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: 'var(--brand-primary)', strokeWidth: 0, style: { cursor: 'pointer' } }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(state: any) => {
              if (state?.payload?.date) router.push(`/calls?date=${encodeURIComponent(state.payload.date)}`)
            }}
            style={{ cursor: 'pointer' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="rounded-xl p-4 sm:p-5 border bg-card-bg">
      <div className="skeleton h-4 w-48 mb-4 rounded" />
      <div className="skeleton w-full rounded" style={{ height: 200 }} />
    </div>
  )
}
