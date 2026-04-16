'use client'

import { motion } from 'motion/react'
import { Target, CheckCircle, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'

interface WeeklyChallengeCardProps {
  lastWeekCalls: number
  thisWeekCalls: number
}

function Confetti() {
  const [particles] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.5,
      size: 4 + Math.random() * 6,
      color: ['#22c55e', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6'][i % 5],
      rotation: Math.random() * 360,
    }))
  )

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, y: 0, x: `${p.x}%`, rotate: 0, scale: 1 }}
          animate={{ opacity: 0, y: -80, rotate: p.rotation, scale: 0 }}
          transition={{ duration: 1.5, delay: p.delay, ease: 'easeOut' }}
          className="absolute bottom-0"
          style={{ width: p.size, height: p.size, backgroundColor: p.color, borderRadius: 2 }}
        />
      ))}
    </div>
  )
}

export default function WeeklyChallengeCard({ lastWeekCalls, thisWeekCalls }: WeeklyChallengeCardProps) {
  const target = Math.max(lastWeekCalls + 1, 1)
  const progress = Math.min((thisWeekCalls / target) * 100, 100)
  const isComplete = thisWeekCalls >= target
  const [showConfetti, setShowConfetti] = useState(false)

  useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => setShowConfetti(true), 600)
      return () => clearTimeout(timer)
    }
  }, [isComplete])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="relative rounded-xl border p-4 sm:p-5 bg-card dark:bg-card mb-6 overflow-hidden"
      style={{ borderColor: isComplete ? 'var(--brand-success)' : 'var(--border)' }}
    >
      {showConfetti && <Confetti />}

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, delay: 0.4 }}
            >
              <Trophy size={16} className="text-brand-success" />
            </motion.div>
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
          ? 'Challenge complete! Your AI Employee crushed it this week. 🎉'
          : `Beat last week: ${lastWeekCalls} conversations → target ${target}`
        }
      </p>

      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1.2, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`h-full rounded-full ${isComplete ? 'bg-brand-success' : 'bg-brand-primary'}`}
        />
      </div>
    </motion.div>
  )
}
