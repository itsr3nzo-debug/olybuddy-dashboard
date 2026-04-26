'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { BannerShell, BannerAction } from '@/components/ui/banner'

interface TrialBannerProps {
  trialEndsAt: string | null
  subscriptionStatus: string
}

/**
 * TrialBanner — v2.
 *
 * Visual: BannerShell with intent driven by urgency. State / dismiss /
 * bad-data sanity logic preserved from v1 — only the chrome moved into
 * the shared shell.
 *
 * Three intents:
 *   info     — > 2 days left
 *   warning  — 1-2 days left ("urgent")
 *   danger   — expired (also: action no longer dismissable)
 */
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
  // Hide the banner entirely rather than nag the user with a meaningless
  // "Trial active" message that reserves vertical space for nothing.
  if (daysLeft > 90) return null

  const message = isExpired
    ? 'Your trial has expired. Upgrade to keep your AI Employee active.'
    : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left on your trial.`

  const intent = isExpired ? 'danger' : isUrgent ? 'warning' : 'info'

  return (
    <BannerShell
      intent={intent}
      icon={Clock}
      onDismiss={isExpired ? undefined : () => setDismissed(true)}
    >
      <span className="font-medium">{message}</span>
      <BannerAction href="/api/stripe/upgrade" intent={intent}>
        Upgrade now
      </BannerAction>
    </BannerShell>
  )
}
