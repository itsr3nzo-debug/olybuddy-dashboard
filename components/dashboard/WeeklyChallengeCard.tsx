'use client'

import { motion } from 'motion/react'
import { Target, CheckCircle } from 'lucide-react'

interface WeeklyChallengeCardProps {
  lastWeekCalls: number
  thisWeekCalls: number
}

export default function WeeklyChallengeCard({ lastWeekCalls, thisWeekCalls }: WeeklyChallengeCardProps) {
  const target = Math.max(lastWeekCalls + 1, 1)
  const progress = Math.min((thisWeekCalls / target) * 100, 100)
  const isComplete = thisWeekCalls >= target

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-xl border p-4 sm:p-5 bg-card dark:bg-card mb-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle size={16} className="text-brand-success" />
          ) : (
            <Target size={16} className="text-brand-primary" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Weekly Challenge
          </span>
        </div>
        <span className={`text-xs font-bold ${isComplete ? 'text-brand-success' : 'text-brand-primary'}`}>
          {thisWeekCalls}/{target}
        </span>
      </div>

      <p className="text-sm text-foreground mb-3">
        {isComplete
          ? 'Challenge complete! Your AI crushed it this week.'
          : `Beat last week: ${lastWeekCalls} calls → target ${target}`
        }
      </p>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`h-full rounded-full ${isComplete ? 'bg-brand-success' : 'bg-brand-primary'}`}
        />
      </div>
    </motion.div>
  )
}
