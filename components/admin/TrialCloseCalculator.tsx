'use client'

/**
 * Client Usage + Close Calculator
 *
 * Three acts for the closing call:
 *   1. See what the AI did (period toggle + stat tiles + activity timeline)
 *   2. See where humans can't compete (reliability: response time, after-hours)
 *   3. Ask the day rate → animated £ value → close
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Link from 'next/link'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import {
  ArrowLeft, Clock, MessageCircle, Calendar, UserPlus, Phone,
  Zap, Moon, CheckCircle2,
} from 'lucide-react'

const MONTHLY_COST = 500
const DAILY_COST = 17

/* ── Types ─────────────────────────────────────── */

export type Period = 'trial' | '30d' | 'all'

interface TrialActivity {
  messagesHandled: number
  bookingsMade: number
  followUpsSent: number
  newContacts: number
  actionsFromLog: number
  minutesSavedFromLog: number
  chatSessions: number
  callsHandled: number
}

interface ReliabilityMetrics {
  totalInteractions: number
  afterHoursCount: number
  afterHoursPct: number
  medianResponseSec: number | null
  medianResponseLabel: string | null
  coveragePct: number | null  // null = not enough data to compute
  failedRepliesCount: number
  userMsgTotal: number
}

export type ActivityItem = {
  id: string
  kind: 'message' | 'booking' | 'lead' | 'call'
  when: string
  title: string
  preview?: string
  channel?: string
  valuePence?: number | null
}

export interface TrialCloseStats {
  clientName: string
  clientId: string
  subscriptionStatus: string
  isTrial: boolean
  period: Period
  windowStart: string
  windowEnd: string
  trialEndsAt: string | null
  activity: TrialActivity
  reliability: ReliabilityMetrics
  totalMinutesSaved: number
  hoursSaved: number
  hasActivity: boolean
  timeline: ActivityItem[]
  daysInPeriod: number
}

/* ── Helpers ───────────────────────────────────── */

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatPence(pence: number | null | undefined): string | null {
  if (!pence || pence <= 0) return null
  return `£${Math.round(pence / 100).toLocaleString('en-GB')}`
}

/* ── Main ──────────────────────────────────────── */

export default function TrialCloseCalculator({ stats }: { stats: TrialCloseStats }) {
  const [rawRate, setRawRate] = useState('')
  const [debouncedTarget, setDebouncedTarget] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const dayRateNum = parseFloat(rawRate.replace(/[^0-9.]/g, '')) || 0
  const hourlyRate = dayRateNum / 8
  const valueSaved = Math.round(stats.hoursSaved * hourlyRate)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTarget(valueSaved), 250)
    return () => clearTimeout(t)
  }, [valueSaved])

  const { activity, reliability, timeline } = stats

  const periodLabel =
    stats.period === 'trial' ? 'During trial' :
    stats.period === '30d'   ? 'Last 30 days' :
                                'All time'

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/admin/close"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            All clients
          </Link>
          <span className="text-xs font-medium text-muted-foreground capitalize">
            {stats.subscriptionStatus} · {stats.clientName}
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-12">

        {/* ══════════ ACT 1 — WHAT THE AI DID ══════════ */}
        <section>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
              <span className="text-purple-500">{stats.clientName}</span>&apos;s AI Employee
            </h1>
            <p className="text-base text-muted-foreground mt-2">
              Aggregate performance only — no message content or customer details are exposed.
            </p>
          </motion.div>

          {/* Period toggle */}
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="flex items-center gap-1 p-1 rounded-xl mb-8 w-fit"
            style={{ background: 'rgb(var(--muted-foreground) / 0.08)' }}
          >
            {stats.isTrial && (
              <PeriodTab clientId={stats.clientId} period="trial" current={stats.period} label="Trial" />
            )}
            <PeriodTab clientId={stats.clientId} period="30d" current={stats.period} label="Last 30 days" />
            <PeriodTab clientId={stats.clientId} period="all" current={stats.period} label="All time" />
          </motion.div>

          {/* Four big stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8"
          >
            <StatTile
              icon={<Clock size={16} />}
              value={stats.hoursSaved > 0 ? `${stats.hoursSaved}h` : '0h'}
              label="Hours saved"
              highlight
            />
            <StatTile
              icon={<MessageCircle size={16} />}
              value={String(activity.messagesHandled)}
              label="Messages handled"
            />
            {activity.callsHandled > 0 ? (
              <StatTile
                icon={<Phone size={16} />}
                value={String(activity.callsHandled)}
                label="Calls handled"
              />
            ) : (
              <StatTile
                icon={<Calendar size={16} />}
                value={String(activity.bookingsMade)}
                label="Bookings made"
              />
            )}
            <StatTile
              icon={<UserPlus size={16} />}
              value={String(activity.newContacts)}
              label="New leads"
            />
          </motion.div>

          {/* Secondary detail line */}
          {(activity.chatSessions > 0 || activity.bookingsMade > 0 || activity.followUpsSent > 0) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground mb-8"
            >
              <span>{periodLabel}</span>
              {activity.chatSessions > 0 && (
                <span>· {activity.chatSessions} chat conversation{activity.chatSessions !== 1 ? 's' : ''}</span>
              )}
              {activity.callsHandled > 0 && activity.bookingsMade > 0 && (
                <span>· {activity.bookingsMade} booking{activity.bookingsMade !== 1 ? 's' : ''}</span>
              )}
              {activity.followUpsSent > 0 && (
                <span>· {activity.followUpsSent} automated follow-up{activity.followUpsSent !== 1 ? 's' : ''}</span>
              )}
            </motion.div>
          )}

          {/* Timeline */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Recent activity
            </h2>
            {timeline.length === 0 ? (
              <div className="rounded-xl border border-border/50 bg-card/30 px-5 py-8 text-sm text-muted-foreground text-center">
                No activity in this period. Try <span className="font-semibold text-foreground">All time</span> above — or the AI Employee is set up and listening.
              </div>
            ) : (
              <div className="space-y-1.5">
                {timeline.map((item, i) => (
                  <TimelineRow key={item.id} item={item} index={i} />
                ))}
              </div>
            )}
          </motion.div>
        </section>

        {/* ══════════ ACT 2 — WHERE HUMANS CAN'T COMPETE ══════════ */}
        {reliability.totalInteractions > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                The AI Employee advantage
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="space-y-2.5"
            >
              {reliability.medianResponseLabel && (
                <ReliabilityRow
                  icon={<Zap size={16} />}
                  color="#F59E0B"
                  headline={reliability.medianResponseLabel}
                  label="Median response time"
                  compare="Most businesses take hours to reply. The AI does it in seconds — every time."
                />
              )}

              {reliability.afterHoursCount > 0 && (
                <ReliabilityRow
                  icon={<Moon size={16} />}
                  color="#8B5CF6"
                  headline={`${reliability.afterHoursCount}`}
                  label="Interactions handled outside 9–6"
                  compare={
                    reliability.afterHoursPct >= 25
                      ? `${reliability.afterHoursPct}% of everything — when they\u2019d be off the clock.`
                      : 'Evenings and weekends — covered automatically.'
                  }
                />
              )}

              {reliability.coveragePct !== null && (
                <ReliabilityRow
                  icon={<CheckCircle2 size={16} />}
                  color="#22C55E"
                  headline={`${reliability.coveragePct}%`}
                  label="Reply rate"
                  compare={
                    reliability.failedRepliesCount > 0
                      ? `${reliability.userMsgTotal - reliability.failedRepliesCount} of ${reliability.userMsgTotal} enquiries answered. Nothing dropped silently.`
                      : `${reliability.userMsgTotal} enquiries — every one got a reply.`
                  }
                />
              )}
            </motion.div>
          </section>
        )}

        {/* ══════════ ACT 3 — DAY RATE → £ VALUE ══════════ */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Now the value
            </span>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-center mb-6"
          >
            <h2 className="text-2xl font-bold mb-1.5">What&apos;s their day rate?</h2>
            <p className="text-sm text-muted-foreground">
              Type their number. We&apos;ll show the value instantly.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35 }}
            className="flex items-center justify-center gap-3 mb-8"
          >
            <motion.div
              animate={{
                boxShadow: dayRateNum > 0
                  ? '0 0 0 6px rgb(139 92 246 / 0.10), 0 8px 32px -12px rgb(139 92 246 / 0.4)'
                  : '0 0 0 0px rgb(139 92 246 / 0.0)',
              }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-2 rounded-2xl px-6 py-5"
              style={{
                background: 'rgb(var(--hy-bg-subtle, var(--muted)) / 0.3)',
                border: `2px solid ${dayRateNum > 0 ? 'rgb(139 92 246 / 0.8)' : 'rgb(var(--border))'}`,
                transition: 'border-color 0.25s',
              }}
            >
              <span className="text-5xl font-bold text-muted-foreground select-none">£</span>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min="0"
                step="50"
                value={rawRate}
                onChange={e => setRawRate(e.target.value)}
                placeholder="300"
                className="text-5xl font-bold bg-transparent outline-none w-40 tabular-nums placeholder:text-muted-foreground/30"
                style={{ color: dayRateNum > 0 ? '#8B5CF6' : undefined }}
              />
            </motion.div>
            <span className="text-xl text-muted-foreground font-medium">/day</span>
          </motion.div>

          <AnimatePresence mode="wait">
            {dayRateNum > 0 && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div
                  className="rounded-2xl p-10 relative overflow-hidden text-center"
                  style={{
                    background: 'linear-gradient(135deg, rgb(139 92 246 / 0.14) 0%, rgb(99 102 241 / 0.08) 50%, rgb(139 92 246 / 0.04) 100%)',
                    border: '1px solid rgb(139 92 246 / 0.3)',
                    boxShadow: '0 12px 40px -12px rgb(139 92 246 / 0.3)',
                  }}
                >
                  {/* Decorative animated blobs */}
                  <motion.div
                    animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0.6, 0.4] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -top-14 -right-14 w-48 h-48 rounded-full bg-purple-500/10"
                  />
                  <motion.div
                    animate={{ scale: [1.05, 1, 1.05], opacity: [0.3, 0.5, 0.3] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
                    className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-indigo-500/10"
                  />

                  <div className="relative z-10">
                    <p className="text-sm text-muted-foreground mb-3 font-medium uppercase tracking-wider">
                      Their AI Employee was worth
                    </p>
                    <div
                      className="text-7xl sm:text-8xl font-black tracking-tight leading-none mb-3 tabular-nums"
                      style={{ color: '#8B5CF6' }}
                    >
                      <AnimatedNumber target={debouncedTarget} prefix="£" duration={600} />
                    </div>
                    <p className="text-base text-muted-foreground">
                      {stats.period === 'trial' ? 'during their 5-day trial.' :
                       stats.period === '30d' ? 'in the last 30 days.' :
                                                'since they joined.'}
                    </p>
                  </div>
                </div>

                {valueSaved > 0 && (() => {
                  const periodCost = DAILY_COST * stats.daysInPeriod
                  const ratio = valueSaved / periodCost
                  const periodLabelShort =
                    stats.period === 'trial' ? `those ${stats.daysInPeriod} days` :
                    stats.period === '30d' ? 'the last 30 days' :
                                             `the past ${stats.daysInPeriod} days`
                  return (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                      className="mt-5 text-center px-4"
                    >
                      <p className="text-sm text-muted-foreground">
                        Nexley would have cost{' '}
                        <span className="font-semibold text-foreground">
                          £{Math.round(periodCost).toLocaleString('en-GB')}
                        </span>{' '}
                        over {periodLabelShort}
                        <span className="text-muted-foreground/70"> (£{DAILY_COST}/day)</span>.
                      </p>
                      {ratio >= 1 ? (
                        <p className="text-sm mt-1" style={{ color: '#8B5CF6' }}>
                          They got <span className="font-bold">{ratio.toFixed(1)}×</span> the subscription back in their own time alone.
                        </p>
                      ) : (
                        <p className="text-sm mt-1" style={{ color: '#8B5CF6' }}>
                          That covers <span className="font-bold">{Math.round(ratio * 100)}%</span> of the subscription from time-saved alone — before counting the 24/7 cover, faster replies, and lead capture.
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground/70 mt-2">
                        Hourly rate assumes an 8-hour working day.
                      </p>
                    </motion.div>
                  )
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  )
}

/* ── Sub-components ────────────────────────────── */

function PeriodTab({ clientId, period, current, label }: {
  clientId: string
  period: Period
  current: Period
  label: string
}) {
  const active = period === current
  return (
    <Link
      href={`/admin/close/${clientId}?period=${period}`}
      scroll={false}
      prefetch={!active}
      className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {active && (
        <motion.span
          layoutId="period-pill"
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="absolute inset-0 rounded-lg bg-card shadow-sm"
          style={{ zIndex: -1 }}
        />
      )}
      <span className="relative">{label}</span>
    </Link>
  )
}

function StatTile({ icon, value, label, highlight = false }: {
  icon: React.ReactNode
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="rounded-xl p-4 cursor-default"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, rgb(139 92 246 / 0.12) 0%, rgb(99 102 241 / 0.07) 100%)'
          : 'rgb(var(--muted-foreground) / 0.05)',
        border: highlight
          ? '1px solid rgb(139 92 246 / 0.3)'
          : '1px solid rgb(var(--border) / 0.5)',
        boxShadow: highlight ? '0 1px 20px -8px rgb(139 92 246 / 0.3)' : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div
        className="text-2xl sm:text-3xl font-bold tabular-nums"
        style={highlight ? { color: '#8B5CF6' } : undefined}
      >
        {value}
      </div>
    </motion.div>
  )
}

function ReliabilityRow({ icon, color, headline, label, compare }: {
  icon: React.ReactNode
  color: string
  headline: string
  label: string
  compare: string
}) {
  return (
    <motion.div
      whileHover={{ x: 2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="flex items-start gap-4 rounded-xl px-5 py-4 cursor-default"
      style={{
        background: 'rgb(var(--muted-foreground) / 0.04)',
        border: '1px solid rgb(var(--border) / 0.5)',
      }}
    >
      <div
        className="flex-shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center relative overflow-hidden"
        style={{ background: `${color}1F`, color }}
      >
        {icon}
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: `linear-gradient(135deg, ${color}44 0%, transparent 70%)` }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
          <span className="text-xl font-bold tabular-nums" style={{ color }}>{headline}</span>
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{compare}</p>
      </div>
    </motion.div>
  )
}

function TimelineRow({ item, index }: { item: ActivityItem; index: number }) {
  const colorByKind: Record<ActivityItem['kind'], { icon: React.ReactNode; bg: string; fg: string }> = {
    message: { icon: <MessageCircle size={14} />, bg: 'rgb(139 92 246 / 0.12)', fg: '#8B5CF6' },
    booking: { icon: <Calendar size={14} />, bg: 'rgb(34 197 94 / 0.12)', fg: '#22C55E' },
    lead:    { icon: <UserPlus size={14} />,    bg: 'rgb(245 158 11 / 0.12)', fg: '#F59E0B' },
    call:    { icon: <Phone size={14} />,       bg: 'rgb(14 165 233 / 0.12)', fg: '#0EA5E9' },
  }
  const m = colorByKind[item.kind]
  const valueLabel = formatPence(item.valuePence)

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 + index * 0.03, duration: 0.3 }}
      whileHover={{ x: 2 }}
      className="flex items-start gap-3 rounded-xl px-4 py-3 cursor-default"
      style={{ background: 'rgb(var(--muted-foreground) / 0.04)', border: '1px solid rgb(var(--border) / 0.4)' }}
    >
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg inline-flex items-center justify-center mt-0.5"
        style={{ background: m.bg, color: m.fg }}
      >
        {m.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
          {valueLabel && (
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#22C55E' }}>
              {valueLabel}
            </span>
          )}
        </div>
        {item.preview && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{item.preview}</p>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-1 tabular-nums">
        {timeAgo(item.when)}
      </span>
    </motion.div>
  )
}
