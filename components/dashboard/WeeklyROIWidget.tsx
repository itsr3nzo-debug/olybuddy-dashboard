'use client'

/**
 * The £599/mo-justification widget. Shown on the main dashboard.
 * Loads /api/dashboard/weekly-stats and renders a "this week your AI Employee
 * did X" panel in terms the owner immediately values: hours saved, £ pipeline,
 * cost avoided vs hiring a receptionist.
 *
 * Designed to answer "what am I paying for?" in one glance.
 */

import { useEffect, useState } from 'react'
import {
  MessageCircle, Calendar, FileText, Star, AlertTriangle,
  TrendingUp, Clock, PoundSterling,
} from 'lucide-react'
import { motion } from 'motion/react'

type Stats = {
  window_days: number
  totals: {
    actions: number
    hours_saved: number
    staff_cost_avoided_gbp: number
    pipeline_value_gbp: number
    booked_value_gbp: number
  }
  counts: Record<string, number>
  recent: { category: string; summary: string | null; occurred_at: string }[]
}

const CATEGORY_LABEL: Record<string, { icon: React.ReactNode; label: string; short: string }> = {
  message_handled:     { icon: <MessageCircle size={14} />,  label: 'Enquiries handled',  short: 'messages' },
  booking_confirmed:   { icon: <Calendar size={14} />,       label: 'Jobs booked',        short: 'bookings' },
  quote_sent:          { icon: <FileText size={14} />,       label: 'Quotes sent',        short: 'quotes' },
  quote_chased:        { icon: <TrendingUp size={14} />,     label: 'Quotes chased',      short: 'chases' },
  review_requested:    { icon: <Star size={14} />,           label: 'Review requests',    short: 'reviews' },
  escalation_to_owner: { icon: <AlertTriangle size={14} />,  label: 'Flagged to you',     short: 'flags' },
}

export default function WeeklyROIWidget() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/weekly-stats', { credentials: 'include' })
        if (!res.ok) throw new Error('load failed')
        const json = await res.json()
        if (!cancelled) {
          setStats(json)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setErr('Could not load weekly summary')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="skeleton rounded-xl h-48 mb-6" />
  }

  if (err || !stats) {
    return null // silent — don't dirty the dashboard
  }

  const { totals, counts } = stats
  const hasAnyActivity = totals.actions > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-card p-5 mb-6"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-0.5">
            Last 7 days — your AI Employee
          </h2>
          <p className="text-xs text-muted-foreground">
            {hasAnyActivity
              ? 'The work you\'d have had to do yourself.'
              : 'No actions logged yet. Your AI Employee will start tracking as customers message in.'}
          </p>
        </div>
      </div>

      {/* Three headline numbers */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <HeadlineMetric
          icon={<Clock size={14} className="text-brand-accent" />}
          label="Hours saved"
          value={`${totals.hours_saved}h`}
          accent="text-foreground"
        />
        <HeadlineMetric
          icon={<PoundSterling size={14} className="text-brand-success" />}
          label="Pipeline booked"
          value={`£${totals.booked_value_gbp.toLocaleString()}`}
          accent="text-brand-success"
        />
        <HeadlineMetric
          icon={<TrendingUp size={14} className="text-brand-accent" />}
          label="Staff cost avoided"
          value={`£${totals.staff_cost_avoided_gbp.toLocaleString()}`}
          accent="text-foreground"
        />
      </div>

      {/* Category punch list */}
      {hasAnyActivity && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {Object.entries(CATEGORY_LABEL).map(([key, meta]) => {
            const count = counts[key] ?? 0
            if (count === 0) return null
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2"
              >
                <span className="text-muted-foreground">{meta.icon}</span>
                <span className="font-medium text-foreground">{count}</span>
                <span className="text-muted-foreground">{meta.short}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ROI framing for the cost-conscious */}
      {hasAnyActivity && totals.staff_cost_avoided_gbp > 0 && (
        <p className="mt-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
          At £15/hr (UK part-time receptionist rate), that's{' '}
          <span className="text-foreground font-medium">
            £{totals.staff_cost_avoided_gbp.toLocaleString()} of staff cost avoided
          </span>{' '}
          this week alone.
        </p>
      )}
    </motion.div>
  )
}

function HeadlineMetric({
  icon, label, value, accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="rounded-lg bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-semibold ${accent}`}>{value}</div>
    </div>
  )
}
