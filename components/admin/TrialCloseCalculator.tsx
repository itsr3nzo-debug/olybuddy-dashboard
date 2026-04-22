'use client'

/**
 * TrialCloseCalculator — the closing tool.
 *
 * The conversation it's designed for:
 *   Kade: "What's your day rate?"
 *   Prospect: "About £300."
 *   Kade: [types 300]
 *   Screen: "Your AI Employee saved you £X"
 *   Prospect: realises it's more than the subscription cost. Closes.
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import Link from 'next/link'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import { ArrowLeft, Clock, MessageCircle, Calendar, UserPlus } from 'lucide-react'

const MONTHLY_COST = 500
const DAILY_COST = 17 // £500 / 30 days, rounded

interface TrialActivity {
  messagesHandled: number
  bookingsMade: number
  followUpsSent: number
  newContacts: number
  actionsFromLog: number
  minutesSavedFromLog: number
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
}

export default function TrialCloseCalculator({ stats }: { stats: TrialCloseStats }) {
  const [rawRate, setRawRate] = useState('')
  const [debouncedTarget, setDebouncedTarget] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const dayRateNum = parseFloat(rawRate.replace(/[^0-9.]/g, '')) || 0
  const hourlyRate = dayRateNum / 8
  const valueSaved = Math.round(stats.hoursSaved * hourlyRate)

  // Debounce the animated reveal so the number doesn't flicker while Kade types
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTarget(valueSaved), 250)
    return () => clearTimeout(t)
  }, [valueSaved])

  const { activity } = stats
  const timesDailyCost = valueSaved > 0 ? (valueSaved / DAILY_COST).toFixed(1) : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Minimal top bar */}
      <div className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/admin/close"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            All clients
          </Link>
          <span className="text-xs font-medium text-muted-foreground">
            {stats.isTrial ? '5-day trial' : 'Last 5 days'} · {stats.clientName}
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Here&apos;s what <span className="text-purple-500">{stats.clientName}</span>&apos;s AI Employee did.
          </h1>
          <p className="text-base text-muted-foreground">
            {stats.isTrial ? 'In 5 days — without lifting a finger.' : 'In the last 5 days.'}
          </p>
        </motion.div>

        {/* Three big activity tiles */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3 mb-10"
        >
          <BigStat
            icon={<Clock size={18} />}
            value={stats.hoursSaved > 0 ? `${stats.hoursSaved}h` : '—'}
            label="Your time saved"
            highlight
          />
          <BigStat
            icon={<MessageCircle size={18} />}
            value={String(activity.messagesHandled)}
            label="Messages handled"
          />
          <BigStat
            icon={<Calendar size={18} />}
            value={String(activity.bookingsMade)}
            label="Bookings made"
          />
        </motion.div>

        {/* Supporting detail row — only show if there's data */}
        {(activity.newContacts > 0 || activity.followUpsSent > 0) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-6 text-sm text-muted-foreground mb-10"
          >
            {activity.newContacts > 0 && (
              <span className="flex items-center gap-1.5">
                <UserPlus size={14} />
                {activity.newContacts} new lead{activity.newContacts !== 1 ? 's' : ''}
              </span>
            )}
            {activity.followUpsSent > 0 && (
              <span>
                · {activity.followUpsSent} automated follow-up{activity.followUpsSent !== 1 ? 's' : ''}
              </span>
            )}
          </motion.div>
        )}

        {/* Empty-state message */}
        {!stats.hasActivity && (
          <div className="rounded-xl border border-border/50 px-5 py-4 mb-10 text-sm text-muted-foreground text-center">
            Your AI Employee is live and ready. Activity will appear here as customers message in.
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-border/40 mb-10" />

        {/* The question — big, clear, central */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center mb-8"
        >
          <h2 className="text-2xl font-semibold mb-2">What&apos;s your day rate?</h2>
          <p className="text-sm text-muted-foreground">
            We&apos;ll show you exactly what those 5 days were worth.
          </p>
        </motion.div>

        {/* The input — HUGE, impossible to miss */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center gap-3 mb-10"
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

        {/* THE RESULT — this is the moment */}
        <AnimatePresence mode="wait">
          {dayRateNum > 0 && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div
                className="rounded-2xl p-8 relative overflow-hidden text-center"
                style={{
                  background: 'linear-gradient(135deg, rgb(139 92 246 / 0.12) 0%, rgb(99 102 241 / 0.08) 100%)',
                  border: '1px solid rgb(139 92 246 / 0.25)',
                }}
              >
                {/* Decorative blobs */}
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
                    {stats.isTrial ? 'to them — in 5 days.' : 'in the last 5 days.'}
                  </p>
                </div>
              </div>

              {/* The compare */}
              {timesDailyCost && Number(timesDailyCost) > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="mt-5 text-center"
                >
                  <p className="text-sm text-muted-foreground">
                    Nexley costs <span className="font-semibold text-foreground">£{MONTHLY_COST}/mo</span> — that&apos;s just{' '}
                    <span className="font-semibold text-foreground">£{DAILY_COST}/day</span>.
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#8B5CF6' }}>
                    You&apos;d be getting <span className="font-bold">{timesDailyCost}×</span> that back — every single day.
                  </p>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function BigStat({ icon, value, label, highlight = false }: {
  icon: React.ReactNode
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-5 text-center"
      style={{
        background: highlight
          ? 'linear-gradient(135deg, rgb(139 92 246 / 0.1) 0%, rgb(99 102 241 / 0.06) 100%)'
          : 'rgb(var(--muted-foreground) / 0.06)',
        border: highlight
          ? '1px solid rgb(139 92 246 / 0.25)'
          : '1px solid rgb(var(--border) / 0.5)',
      }}
    >
      <div className="flex items-center justify-center mb-2 text-muted-foreground">
        {icon}
      </div>
      <div
        className="text-3xl font-bold mb-1"
        style={highlight ? { color: '#8B5CF6' } : undefined}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
