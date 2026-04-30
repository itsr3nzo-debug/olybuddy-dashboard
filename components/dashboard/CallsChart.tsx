'use client'

import { useRouter } from 'next/navigation'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface CallsChartProps {
  data: Array<{ date: string; calls: number }>
}

/**
 * CallsChart — v2.
 *
 * Stripped of:
 * - AreaChart with gradient fill → LineChart, no fill (Linear/Vercel
 *   pattern; chart fill = AI hero-card aesthetic)
 * - rounded-xl → 8px (Card primitive)
 * - "Activity" → "Conversations" label (more accurate; "calls" was
 *   misleading since it includes WhatsApp messages)
 *
 * Replaced with:
 * - LineChart, 1.5px stroke, primary navy
 * - Hairline horizontal grid lines only
 * - 11px axis labels in muted-foreground
 * - Tooltip with hairline border + 8px radius
 * - Dot only on activeDot hover (no permanent dots)
 */
export default function CallsChart({ data }: CallsChartProps) {
  const router = useRouter()
  const total = data.reduce((s, d) => s + d.calls, 0)
  const peak = data.reduce((max, d) => (d.calls > max.calls ? d : max), data[0])

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">
            Conversations — last 7 days
          </h2>
          {peak && peak.calls > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Peak: {peak.date} ({peak.calls} {peak.calls === 1 ? 'conversation' : 'conversations'})
            </p>
          )}
        </div>
        <span className="font-mono tabular-nums text-xs text-muted-foreground">
          {total} total
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="0"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--popover-foreground)',
              padding: '8px 12px',
            }}
            cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
            formatter={(v) => [`${v} ${v === 1 ? 'conversation' : 'conversations'}`, '']}
            labelStyle={{ fontWeight: 500, marginBottom: 2 }}
          />
          <Line
            type="monotone"
            dataKey="calls"
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--primary)',
              strokeWidth: 0,
              style: { cursor: 'pointer' },
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(state: any) => {
              if (state?.payload?.date)
                router.push(`/calls?date=${encodeURIComponent(state.payload.date)}`)
            }}
            style={{ cursor: 'pointer' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  )
}

export function ChartSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="skeleton h-4 w-48 mb-4 rounded" />
      <div className="skeleton w-full rounded" style={{ height: 200 }} />
    </div>
  )
}
