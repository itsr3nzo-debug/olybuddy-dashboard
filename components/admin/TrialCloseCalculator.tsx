'use client'

/**
 * TrialCloseCalculator — the closing tool Kade uses after a 5-day trial.
 *
 * Kade asks: "What's your day rate?"
 * Prospect types it in.
 * The number does the closing.
 *
 * No localStorage — ephemeral state, typed live on the call.
 * No API calls — server component pre-fetches everything and passes as props.
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Link from 'next/link'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import {
  ArrowLeft, MessageCircle, Calendar,
  FileText, TrendingUp, Star, Clock,
  Zap, PoundSterling,
} from 'lucide-react'

const MONTHLY_COST = 500   // £500/mo AI Employee subscription
const DAILY_COST = Math.round(MONTHLY_COST / 30)  // ≈ £17/day

const MINS_PER_MESSAGE = 5   // time saved per handled message
const MINS_PER_BOOKING = 30  // time saved per booking made

interface TrialActivity {
  messagesHandled: number
  bookingsMade: number
  followUpsSent: number
  newContacts: number
  actionsFromLog: number   // from agent_actions if populated
  minutesSavedFromLog: number
}

export interface TrialCloseStats {
  clientName: string
  trialStartedAt: string
  trialEndsAt: string | null
  activity: TrialActivity
  // Pre-computed totals
  totalMinutesSaved: number
  hoursSaved: number
  hasActivity: boolean
}

export default function TrialCloseCalculator({ stats }: { stats: TrialCloseStats }) {
  const [rawRate, setRawRate] = useState('')
  const [animTarget, setAnimTarget] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input so Kade can type immediately
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const dayRateNum = parseFloat(rawRate.replace(/[^0-9.]/g, '')) || 0
  const hourlyRate = dayRateNum / 8
  const valueSaved = Math.round(stats.hoursSaved * hourlyRate)

  // Debounce the animated number by 300ms — avoids animation stuttering while typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setAnimTarget(valueSaved), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [valueSaved])

  const { activity } = stats

  const TASK_ROWS = [
    { icon: <MessageCircle size={15} />, label: 'Messages replied to', count: activity.messagesHandled, note: `~${MINS_PER_MESSAGE} min each` },
    { icon: <Calendar size={15} />,      label: 'Bookings made',       count: activity.bookingsMade,   note: `~${MINS_PER_BOOKING} min each` },
    { icon: <TrendingUp size={15} />,    label: 'Follow-ups sent',     count: activity.followUpsSent,  note: 'automated' },
    { icon: <FileText size={15} />,      label: 'New leads captured',  count: activity.newContacts,    note: 'contacts created' },
  ].filter(r => r.count > 0)

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav — minimal, for screen-share */}
      <div className="border-b border-border/50 px-6 py-3 flex items-center gap-4">
        <Link
          href="/admin/close"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          All trials
        </Link>
        <span className="text-border">·</span>
        <span className="text-sm font-medium text-foreground">{stats.clientName}</span>
        <span className="ml-auto text-xs text-muted-foreground">5-day trial close</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            What did your AI Employee actually do?
          </h1>
          <p className="text-sm text-muted-foreground">
            In 5 days of trial — here&apos;s what it handled so you didn&apos;t have to.
          </p>
        </div>

        {/* Activity proof */}
        {stats.hasActivity ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 gap-3 mb-8"
          >
            <StatTile
              icon={<Clock size={16} className="text-brand-accent" />}
              label="Hours saved"
              value={`${stats.hoursSaved}h`}
              highlight
            />
            <StatTile
              icon={<MessageCircle size={16} />}
              label="Messages"
              value={String(activity.messagesHandled)}
            />
            <StatTile
              icon={<Calendar size={16} className="text-brand-success" />}
              label="Bookings"
              value={String(activity.bookingsMade)}
            />
          </motion.div>
        ) : (
          <div
            className="rounded-xl border border-border/50 px-5 py-4 mb-8 text-sm text-muted-foreground"
          >
            <Zap size={14} className="inline-block mr-2 text-brand-accent" />
            AI Employee is live. Interactions will appear here as activity comes in.
            The calculator below still works — enter a day rate.
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border/40 mb-8" />

        {/* THE QUESTION — this is the moment */}
        <div className="mb-8">
          <p className="text-base font-medium text-foreground mb-4">
            What&apos;s your day rate?
          </p>

          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 border"
              style={{
                background: 'rgb(var(--hy-bg-subtle, var(--muted)) / 0.3)',
                borderColor: dayRateNum > 0
                  ? 'rgb(139 92 246 / 0.6)'
                  : 'rgb(var(--border))',
                transition: 'border-color 0.2s',
              }}
            >
              <span className="text-2xl font-bold text-muted-foreground select-none">£</span>
              <input
                ref={inputRef}
                type="number"
                min="0"
                step="50"
                value={rawRate}
                onChange={e => setRawRate(e.target.value)}
                placeholder="e.g. 300"
                className="text-2xl font-bold text-foreground bg-transparent outline-none w-32 placeholder:text-muted-foreground/40"
              />
            </div>
            <span className="text-base text-muted-foreground">/day</span>
          </div>
        </div>

        {/* THE NUMBER — this closes the deal */}
        <AnimatePresence>
          {dayRateNum > 0 && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="mb-8"
            >
              <div
                className="rounded-2xl p-6 relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, rgb(139 92 246 / 0.12) 0%, rgb(99 102 241 / 0.08) 100%)',
                  border: '1px solid rgb(139 92 246 / 0.25)',
                }}
              >
                {/* Decorative */}
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-purple-500/5" />
                <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full bg-indigo-500/5" />

                <div className="relative z-10">
                  <p className="text-sm text-muted-foreground mb-2">
                    Your AI Employee was worth
                  </p>
                  <div className="flex items-end gap-3 mb-2">
                    <span
                      className="text-6xl font-black tracking-tight"
                      style={{ color: '#8B5CF6' }}
                    >
                      <AnimatedNumber
                        target={animTarget}
                        prefix="£"
                        duration={700}
                        className="text-6xl font-black tracking-tight"
                      />
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    to you in those 5 days.
                  </p>
                </div>
              </div>

              {/* The compare */}
              <div
                className="rounded-xl px-4 py-3 mt-3 flex items-center justify-between"
                style={{
                  background: 'rgb(var(--muted-foreground) / 0.06)',
                  border: '1px solid rgb(var(--border) / 0.5)',
                }}
              >
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">£{MONTHLY_COST}/mo</span> subscription
                  {' '}= £{DAILY_COST}/day
                </div>
                {valueSaved > 0 && (
                  <div className="text-xs font-semibold" style={{ color: '#8B5CF6' }}>
                    {(valueSaved / DAILY_COST).toFixed(1)}× daily value
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Task breakdown — proof below the fold */}
        {TASK_ROWS.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              What it handled
            </p>
            <div className="space-y-2">
              {TASK_ROWS.map(row => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg px-4 py-3"
                  style={{ background: 'rgb(var(--muted-foreground) / 0.05)', border: '1px solid rgb(var(--border) / 0.4)' }}
                >
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="text-muted-foreground/60">{row.icon}</span>
                    <span>{row.label}</span>
                    <span className="text-xs opacity-60">{row.note}</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{row.count}</span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground mt-3">
              Time saved estimated at {MINS_PER_MESSAGE} min per message handled and {MINS_PER_BOOKING} min per booking.
              Based on {stats.totalMinutesSaved} minutes of tracked activity.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ icon, label, value, highlight = false }: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, rgb(139 92 246 / 0.1) 0%, rgb(99 102 241 / 0.07) 100%)'
          : 'rgb(var(--muted-foreground) / 0.06)',
        border: highlight
          ? '1px solid rgb(139 92 246 / 0.2)'
          : '1px solid rgb(var(--border) / 0.5)',
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold ${highlight ? '' : 'text-foreground'}`}
        style={highlight ? { color: '#8B5CF6' } : undefined}>
        {value}
      </div>
    </div>
  )
}
