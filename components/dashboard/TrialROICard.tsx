'use client'

/**
 * TrialROICard — 5-day trial scorecard with day rate input.
 *
 * Shows:
 *   1. Per-day activity bars (what the AI Employee did each day of the trial)
 *   2. Headline totals: hours saved, actions taken, value booked
 *   3. Day rate input — owner enters their day rate (£/day)
 *   4. Calculated: time_saved_hours × (day_rate / 8) = money value at their rate
 *   5. ROI framing: trial cost vs value created
 */

import { useEffect, useState, useRef } from 'react'
import { motion } from 'motion/react'
import {
  Clock, PoundSterling, Zap, TrendingUp,
  MessageCircle, Calendar, FileText, Star,
  ChevronRight, Edit3,
} from 'lucide-react'

const LS_KEY = 'nexley_day_rate_gbp'
const TRIAL_COST = 20 // £20 — the 5-day AI Employee trial price

/* ── Helpers ─────────────────────────────────── */

function fmt(n: number, prefix = '') {
  if (n >= 1000) return `${prefix}${Math.round(n / 1000)}k`
  return `${prefix}${n.toLocaleString('en-GB')}`
}

function fmtHours(h: number) {
  if (h < 1) {
    const mins = Math.round(h * 60)
    return `${mins}m`
  }
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  return `${whole}h ${mins}m`
}

const CATEGORY_ICONS: Record<string, { icon: React.ReactNode; label: string }> = {
  message_handled:     { icon: <MessageCircle size={11} />, label: 'Enquiries' },
  booking_confirmed:   { icon: <Calendar size={11} />,      label: 'Bookings' },
  quote_sent:          { icon: <FileText size={11} />,      label: 'Quotes' },
  review_requested:    { icon: <Star size={11} />,          label: 'Reviews' },
  follow_up_sent:      { icon: <TrendingUp size={11} />,    label: 'Follow-ups' },
}

/* ── Types ───────────────────────────────────── */

type DayData = {
  date: string
  label: string
  dayOfWeek: string
  actions: number
  minutes_saved: number
  value_gbp: number
  categories: Record<string, number>
}

type Stats = {
  trial_started_at: string
  window_days: number
  subscription_plan: string
  days: DayData[]
  totals: {
    actions: number
    minutes_saved: number
    hours_saved: number
    staff_cost_avoided_gbp: number
    pipeline_value_gbp: number
    booked_value_gbp: number
  }
}

/* ── Sub-components ──────────────────────────── */

function DayBar({ day, maxActions, index }: { day: DayData; maxActions: number; index: number }) {
  const pct = maxActions > 0 ? Math.max(4, Math.round((day.actions / maxActions) * 100)) : 4

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.35 }}
      className="flex flex-col items-center gap-1.5 flex-1"
    >
      {/* Bar */}
      <div className="w-full flex flex-col justify-end" style={{ height: 64 }}>
        <div className="relative w-full rounded-lg overflow-hidden" style={{ height: `${pct}%`, minHeight: 4 }}>
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              background: day.actions === 0
                ? 'rgb(var(--muted-foreground) / 0.12)'
                : 'linear-gradient(180deg, #8B5CF6 0%, #6366F1 100%)',
            }}
          />
          {day.actions > 0 && (
            <div
              className="absolute inset-0 rounded-lg opacity-30"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 60%)' }}
            />
          )}
        </div>
      </div>

      {/* Action count */}
      <span className="text-[11px] font-semibold" style={{ color: day.actions > 0 ? 'rgb(var(--foreground))' : 'rgb(var(--muted-foreground))' }}>
        {day.actions > 0 ? day.actions : '—'}
      </span>

      {/* Label */}
      <span className="text-[10px] text-muted-foreground font-medium">{day.label}</span>
      <span className="text-[9px] text-muted-foreground opacity-70">{day.dayOfWeek}</span>
    </motion.div>
  )
}

function HeadlineStat({ icon, label, value, sub, accent = false }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'rgb(var(--hy-bg-subtle, var(--muted)) / 0.4)' }}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-bold ${accent ? 'text-brand-success' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

/* ── Main component ──────────────────────────── */

export default function TrialROICard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)

  // Day rate state — persisted to localStorage
  const [dayRate, setDayRate] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load from localStorage on mount (always after hydration, no SSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) setDayRate(saved)
    } catch { /* private/SSR mode — ignore */ }
  }, [])

  const saveDayRate = (val: string) => {
    setDayRate(val)
    try { localStorage.setItem(LS_KEY, val) } catch { /* ignore */ }
  }

  // Load trial stats
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/trial-stats', { credentials: 'include' })
        if (!res.ok) throw new Error('load failed')
        const json = await res.json()
        if (!cancelled) { setStats(json); setLoading(false) }
      } catch {
        if (!cancelled) { setErr(true); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  if (loading) return <div className="skeleton rounded-2xl h-72 mb-6" />
  // Silent fail — don't show a broken scorecard to a trial customer
  if (err || !stats) return null
  // Only show for trial plans — paid customers don't need the £20 ROI framing
  if (stats.subscription_plan !== 'trial' && stats.subscription_plan !== 'ai-employee-trial') return null

  const { totals, days } = stats
  const maxActions = Math.max(...days.map(d => d.actions), 1)

  // Money saved at their day rate (assuming 8hr working day)
  const dayRateNum = parseFloat(dayRate.replace(/[^0-9.]/g, '')) || 0
  const hourlyRate = dayRateNum / 8
  const valueSavedAtDayRate = Math.round(totals.hours_saved * hourlyRate)
  const roiMultiple: number | null = valueSavedAtDayRate > 0 && TRIAL_COST > 0
    ? parseFloat((valueSavedAtDayRate / TRIAL_COST).toFixed(1))
    : null

  // Top categories across all days
  const categoryTotals: Record<string, number> = {}
  for (const day of days) {
    for (const [cat, count] of Object.entries(day.categories)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + count
    }
  }
  const topCategories = Object.entries(categoryTotals)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  const hasActivity = totals.actions > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-2xl border mb-6 overflow-hidden"
      style={{ background: 'rgb(var(--hy-card-bg, var(--card)))', borderColor: 'rgb(var(--hy-border, var(--border)) / 0.8)' }}
    >
      {/* Header */}
      <div
        className="px-5 pt-5 pb-4"
        style={{ borderBottom: '1px solid rgb(var(--hy-border, var(--border)) / 0.5)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div
                className="inline-flex items-center justify-center w-6 h-6 rounded-lg text-white"
                style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
              >
                <Zap size={12} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">5-Day Trial Scorecard</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {hasActivity
                ? `${totals.actions} action${totals.actions !== 1 ? 's' : ''} taken · ${fmtHours(totals.hours_saved)} of your time saved`
                : 'Activity will appear here as your AI Employee handles enquiries'}
            </p>
          </div>
          {hasActivity && (
            <div
              className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold"
              style={{ background: 'rgb(var(--brand-success, 34 197 94) / 0.12)', color: 'rgb(var(--brand-success, 34 197 94))' }}
            >
              Active
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        {/* Per-day bar chart */}
        <div className="mb-5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Actions per day</p>
          <div className="flex gap-2 items-end">
            {days.map((day, i) => (
              <DayBar key={day.date} day={day} maxActions={maxActions} index={i} />
            ))}
            {/* Pad to 5 days if trial hasn't run yet */}
            {Array.from({ length: Math.max(0, 5 - days.length) }).map((_, i) => (
              <div key={`pad-${i}`} className="flex flex-col items-center gap-1.5 flex-1">
                <div className="w-full flex flex-col justify-end" style={{ height: 64 }}>
                  <div className="w-full rounded-lg" style={{ height: 4, background: 'rgb(var(--muted-foreground) / 0.1)' }} />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground opacity-40">—</span>
                <span className="text-[10px] text-muted-foreground font-medium opacity-60">Day {days.length + i + 1}</span>
                <span className="text-[9px] text-muted-foreground opacity-40">Soon</span>
              </div>
            ))}
          </div>
        </div>

        {/* Headline stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <HeadlineStat
            icon={<Clock size={12} />}
            label="Time saved"
            value={fmtHours(totals.hours_saved)}
            sub={`${totals.minutes_saved}m total`}
          />
          <HeadlineStat
            icon={<Zap size={12} />}
            label="Actions taken"
            value={fmt(totals.actions)}
            sub="in 5 days"
          />
          <HeadlineStat
            icon={<PoundSterling size={12} />}
            label="Pipeline value"
            value={fmt(totals.pipeline_value_gbp, '£')}
            sub="booked & quoted"
            accent
          />
        </div>

        {/* Top categories punch list */}
        {topCategories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {topCategories.map(([cat, count]) => {
              const meta = CATEGORY_ICONS[cat]
              const label = meta?.label ?? cat.replace(/_/g, ' ')
              const icon = meta?.icon ?? <Zap size={11} />
              return (
                <div
                  key={cat}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
                  style={{
                    background: 'rgb(var(--muted-foreground) / 0.08)',
                    color: 'rgb(var(--muted-foreground))',
                  }}
                >
                  <span>{icon}</span>
                  <span className="font-medium text-foreground">{count}</span>
                  <span>{label}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Day rate input + ROI calculation */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'linear-gradient(135deg, rgb(139 92 246 / 0.06) 0%, rgb(99 102 241 / 0.06) 100%)',
            border: '1px solid rgb(139 92 246 / 0.2)',
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-xs font-semibold text-foreground mb-0.5">What's your time worth?</p>
              <p className="text-[11px] text-muted-foreground">
                Enter your day rate to see the real value your AI Employee created.
              </p>
            </div>
          </div>

          {/* Day rate input */}
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 flex-1 max-w-[200px]"
              style={{
                background: 'rgb(var(--hy-card-bg, var(--card)))',
                border: '1px solid rgb(139 92 246 / 0.3)',
              }}
            >
              <span className="text-sm font-semibold text-muted-foreground">£</span>
              {editing ? (
                <input
                  ref={inputRef}
                  type="number"
                  min="0"
                  step="50"
                  value={dayRate}
                  onChange={e => saveDayRate(e.target.value)}
                  onBlur={() => setEditing(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditing(false) }}
                  className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none w-24"
                  placeholder="450"
                />
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 flex items-center justify-between gap-2 text-sm font-semibold text-foreground text-left"
                >
                  <span>{dayRate ? Number(dayRate).toLocaleString('en-GB') : <span className="text-muted-foreground font-normal">e.g. 450</span>}</span>
                  <Edit3 size={12} className="text-muted-foreground opacity-60" />
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">/day</span>
          </div>

          {/* Calculated value */}
          {dayRateNum > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {fmtHours(totals.hours_saved)} × £{Math.round(hourlyRate)}/hr =
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-lg font-bold"
                    style={{ color: '#8B5CF6' }}
                  >
                    £{valueSavedAtDayRate.toLocaleString('en-GB')}
                  </span>
                  <span className="text-xs text-muted-foreground">saved</span>
                </div>
              </div>

              {roiMultiple !== null && roiMultiple > 0 && (
                <div
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: 'rgb(139 92 246 / 0.08)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <TrendingUp size={12} style={{ color: '#8B5CF6' }} />
                    <span className="text-xs text-muted-foreground">vs £{TRIAL_COST} trial cost</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold" style={{ color: '#8B5CF6' }}>
                      {roiMultiple}× return
                    </span>
                    <ChevronRight size={12} style={{ color: '#8B5CF6' }} />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                Hourly rate calculated as £{Number(dayRate).toLocaleString('en-GB')}/day ÷ 8hr working day = £{Math.round(hourlyRate)}/hr.
                Based on actions logged by your AI Employee.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Once you enter your day rate, we&apos;ll calculate exactly how much your AI Employee saved you in pound terms.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
