'use client'

import { useState } from 'react'
import { Clock, Zap, X } from 'lucide-react'

interface TrialBannerProps {
  trialEndsAt: string | null
  subscriptionStatus: string
}

export default function TrialBanner({ trialEndsAt, subscriptionStatus }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || subscriptionStatus !== 'trial' || !trialEndsAt) return null

  const now = new Date()
  const end = new Date(trialEndsAt)
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
  const isExpired = daysLeft === 0
  const isUrgent = daysLeft <= 2

  return (
    <div className={`relative rounded-xl border px-4 py-3 mb-6 flex items-center justify-between ${
      isExpired
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : isUrgent
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
    }`}>
      <div className="flex items-center gap-3">
        <Clock size={16} />
        <span className="text-sm font-medium">
          {isExpired
            ? 'Your trial has expired. Upgrade to keep your AI Employee active.'
            : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on your trial.`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <a
          href="/api/stripe/upgrade"
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Zap size={14} />
          Upgrade Now
        </a>
        {!isExpired && (
          <button onClick={() => setDismissed(true)} className="p-1 hover:opacity-70 transition-opacity">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
