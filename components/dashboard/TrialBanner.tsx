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
  const isUrgent = daysLeft > 0 && daysLeft <= 2

  // Sanity cap — a "trial" with > 90 days left is almost certainly bad
  // data (saw a row with trial_ends_at = year 2099 → 26913 days left).
  // Render a soft "Trial active" message instead of a misleading number.
  const looksLikeBadData = daysLeft > 90

  let message: string
  if (isExpired) message = 'Your trial has expired. Upgrade to keep your AI Employee active.'
  else if (looksLikeBadData) message = 'Trial active — upgrade any time.'
  else message = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on your trial.`

  return (
    <div className={`relative rounded-xl border px-4 py-3 mb-6 flex items-center justify-between ${
      isExpired
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : isUrgent
        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
        : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <Clock size={16} className="flex-shrink-0" />
        <span className="text-sm font-medium truncate">{message}</span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href="/api/stripe/upgrade"
          // Solid indigo background + explicit white text so the label is always
          // readable (was: bg-brand-primary which can render as transparent on
          // some Tailwind v4 / theme combos, leaving an empty pill).
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold shadow-sm transition-colors"
        >
          <Zap size={14} className="flex-shrink-0" />
          <span>Upgrade Now</span>
        </a>
        {!isExpired && (
          <button onClick={() => setDismissed(true)} className="p-1 hover:opacity-70 transition-opacity" aria-label="Dismiss banner">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
