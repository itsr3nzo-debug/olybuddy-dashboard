'use client'

/**
 * Client Usage + Close Calculator
 *
 * Two acts:
 *   Act 1 — "See what their AI Employee did" (stats + timeline)
 *   Act 2 — "Now ask their day rate" (calculator, animated result)
 *
 * Ephemeral day rate (no localStorage — pure live input during a call).
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Link from 'next/link'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import {
  ArrowLeft, Clock, MessageCircle, Calendar, UserPlus, Phone,
} from 'lucide-react'

const MONTHLY_COST = 500
const DAILY_COST = 17 // £500 / 30 days, rounded

/* ── Types ─────────────────────────────────────── */

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

export type ActivityItem = {
  id: string
  kind: 'message' | 'booking' | 'lead' | 'call'
  when: string  // ISO
  title: string
  preview?: string
  channel?: string
  valuePence?: number | null
}

export interface TrialCloseStats {
  clientName: string
  subscriptionStatus: string
  isTrial: boolean
  trialStartedAt: string
  trialEndsAt: string | null
  activity: TrialActivity
  totalMinutesSaved: number
  hoursSaved: number
  hasActivity: boolean
  timeline: ActivityItem[]
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

/* ── Main component ────────────────────────────── */

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

  const { activity, timeline } = stats
  const windowLabel = stats.isTrial ? 'During their 5-day trial' : 'In the last 5 days'

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

        {/* ═══════════ ACT 1 — WHAT THE AI DID ═══════════ */}
        <section>
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {windowLabel}
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
              <span className="text-purple-500">{stats.clientName}</span>&apos;s AI Employee
            </h1>
            <p className="text-base text-muted-foreground mt-2">
              Here&apos;s exactly what it did — without anyone lifting a finger.
            </p>
          </motion.div>

          {/* Four big stats — hours always shown, then 3 biggest real numbers */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
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

          {/* Secondary line — shown only when there's additional data */}
          {(activity.chatSessions > 0 || activity.bookingsMade > 0 || activity.followUpsSent > 0) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 }}
              className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground mb-8"
            >
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

          {/* Activity timeline */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }}
          >
            <h2 className="text-sm font-semibold text-foreground mb-3">
              Recent activity
            </h2>

            {timeline.length === 0 ? (
              <div className="rounded-xl border border-border/50 px-5 py-6 text-sm text-muted-foreground text-center">
                No activity yet in this window. The AI Employee is set up and listening.
              </div>
            ) : (
              <div className="space-y-1.5">
                {timeline.map((item) => (
                  <TimelineRow key={item.id} item={item} />
                ))}
                {activity.followUpsSent > 0 && (
                  <div className="text-[11px] text-muted-foreground pt-2 pl-2">
                    + {activity.followUpsSent} automated follow-up{activity.followUpsSent !== 1 ? 's' : ''} sent
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </section>

        {/* ═══════════ ACT 2 — DAY RATE → VALUE ═══════════ */}
        <section className="pt-4">
          {/* Divider with label */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Now the value
            </span>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          {/* The question */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center mb-6"
          >
            <h2 className="text-2xl font-bold mb-1.5">What&apos;s their day rate?</h2>
            <p className="text-sm text-muted-foreground">
              Type their number. We&apos;ll show the value instantly.
            </p>
          </motion.div>

          {/* The input */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.26 }}
            className="flex items-center justify-center gap-3 mb-8"
          >
            <div
              className="flex items-center gap-2 rounded-2xl px-6 py-5 transition-all"
              style={{
                background: 'rgb(var(--hy-bg-subtle, var(--muted)) / 0.3)',
                border: `2px solid ${dayRateNum > 0 ? 'rgb(139 92 246 / 0.8)' : 'rgb(var(--border))'}`,
                boxShadow: dayRateNum > 0 ? '0 0 0 6px rgb(139 92 246 / 0.08)' : 'none',
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
                className="text-5xl font-bold bg-transparent outline-none w-40 placeholder:text-muted-foreground/30"
                style={{ color: dayRateNum > 0 ? '#8B5CF6' : undefined }}
              />
            </div>
            <span className="text-xl text-muted-foreground font-medium">/day</span>
          </motion.div>

          {/* The result */}
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
                  className="rounded-2xl p-8 relative overflow-hidden text-center"
                  style={{
                    background: 'linear-gradient(135deg, rgb(139 92 246 / 0.12) 0%, rgb(99 102 241 / 0.08) 100%)',
                    border: '1px solid rgb(139 92 246 / 0.25)',
                  }}
                >
                  <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-purple-500/8" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-indigo-500/8" />

                  <div className="relative z-10">
                    <p className="text-base text-muted-foreground mb-3">
                      Their AI Employee was worth
                    </p>
                    <div
                      className="text-7xl sm:text-8xl font-black tracking-tight leading-none mb-3"
                      style={{ color: '#8B5CF6' }}
                    >
                      <AnimatedNumber target={debouncedTarget} prefix="£" duration={600} />
                    </div>
                    <p className="text-base text-muted-foreground">
                      {stats.isTrial ? 'to them — in those 5 days.' : 'in the last 5 days.'}
                    </p>
                  </div>
                </div>

                {/* Compare */}
                {valueSaved > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="mt-5 text-center px-4"
                  >
                    <p className="text-sm text-muted-foreground">
                      Nexley costs <span className="font-semibold text-foreground">£{MONTHLY_COST}/mo</span>{' — '}
                      just <span className="font-semibold text-foreground">£{DAILY_COST}/day</span>.
                    </p>
                    <p className="text-sm mt-1" style={{ color: '#8B5CF6' }}>
                      They&apos;re getting <span className="font-bold">{(valueSaved / DAILY_COST).toFixed(1)}×</span> that back — every single day.
                    </p>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  )
}

/* ── Sub-components ────────────────────────────── */

function StatTile({ icon, value, label, highlight = false }: {
  icon: React.ReactNode
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, rgb(139 92 246 / 0.1) 0%, rgb(99 102 241 / 0.06) 100%)'
          : 'rgb(var(--muted-foreground) / 0.05)',
        border: highlight
          ? '1px solid rgb(139 92 246 / 0.25)'
          : '1px solid rgb(var(--border) / 0.5)',
      }}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div
        className="text-2xl sm:text-3xl font-bold"
        style={highlight ? { color: '#8B5CF6' } : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function TimelineRow({ item }: { item: ActivityItem }) {
  const colorByKind: Record<ActivityItem['kind'], { icon: React.ReactNode; bg: string; fg: string }> = {
    message: {
      icon: <MessageCircle size={14} />,
      bg: 'rgb(139 92 246 / 0.12)',
      fg: '#8B5CF6',
    },
    booking: {
      icon: <Calendar size={14} />,
      bg: 'rgb(34 197 94 / 0.12)',
      fg: '#22C55E',
    },
    lead: {
      icon: <UserPlus size={14} />,
      bg: 'rgb(245 158 11 / 0.12)',
      fg: '#F59E0B',
    },
    call: {
      icon: <Phone size={14} />,
      bg: 'rgb(14 165 233 / 0.12)',
      fg: '#0EA5E9',
    },
  }
  const m = colorByKind[item.kind]
  const valueLabel = formatPence(item.valuePence)

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-4 py-3"
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
      <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-1">
        {timeAgo(item.when)}
      </span>
    </div>
  )
}
