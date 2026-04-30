'use client'

/**
 * EmailVerificationBanner — v2.
 *
 * Persistent banner shown to logged-in users whose email isn't verified
 * yet. Polls /api/auth/resend-verification on a 30s interval so a user
 * who verifies in another tab sees the banner disappear without a hard
 * refresh; also catches the ?verify=ok redirect from the email link
 * and clears the URL param.
 *
 * Resend rate limit: 3/hr per client (enforced server-side). UI debounces
 * with a 60s cooldown.
 *
 * v2: chrome rewritten to use BannerShell. Behavioural state machine
 * (verified | dismissed | sending | sentAt | error) preserved verbatim.
 */

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { BannerShell } from '@/components/ui/banner'
import { cn } from '@/lib/utils'

interface Props {
  email: string
}

export default function EmailVerificationBanner({ email }: Props) {
  const [verified, setVerified] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Tick state — re-renders the component every second while a cooldown is
  // active so the "Wait 58s … Wait 57s …" countdown actually counts down.
  // Without this, the cooldownMs computed inline below was frozen at the
  // value when sentAt was set, and the button label stayed at "Wait 60s"
  // until the next 30s verified-poll incidentally re-rendered. (DA P0 fix.)
  const [, setNow] = useState(() => Date.now())

  // Re-check verified state on mount + every 30s.
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const r = await fetch('/api/auth/resend-verification', { method: 'GET', cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setVerified(!!data.verified)
      } catch {
        /* network blip — silent */
      }
    }
    check()
    const t = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Cooldown tick — runs ONLY while sentAt is set and the 60s window is
  // still open. Stops itself when the cooldown expires so we don't burn
  // a setInterval forever.
  useEffect(() => {
    if (!sentAt) return
    const remaining = 60_000 - (Date.now() - sentAt)
    if (remaining <= 0) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    const stop = setTimeout(() => clearInterval(id), remaining + 50)
    return () => {
      clearInterval(id)
      clearTimeout(stop)
    }
  }, [sentAt])

  // ?verify=ok set by the verify-email redirect — show success then strip.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('verify') === 'ok') {
      setVerified(true)
      params.delete('verify')
      const qs = params.toString()
      const newUrl = window.location.pathname + (qs ? '?' + qs : '')
      window.history.replaceState({}, '', newUrl)
    }
  }, [])

  async function resend() {
    setSending(true)
    setError(null)
    try {
      const r = await fetch('/api/auth/resend-verification', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) {
        setError(data.error || 'Failed to send. Try again later.')
      } else if (data.alreadyVerified) {
        setVerified(true)
      } else {
        setSentAt(Date.now())
      }
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  if (verified === true || verified === null || dismissed) return null

  const cooldownMs = sentAt ? Math.max(0, 60_000 - (Date.now() - sentAt)) : 0
  const cooldownActive = cooldownMs > 0

  return (
    <BannerShell intent="warning" icon={Mail} onDismiss={() => setDismissed(true)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Verify your email</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sentAt ? (
              <>Verification email re-sent to <span className="font-medium text-foreground">{email}</span>. Check your inbox and spam folder.</>
            ) : (
              <>We sent a verification link to <span className="font-medium text-foreground">{email}</span>. Verifying unlocks subscription cancellation and account changes.</>
            )}
          </p>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        <button
          type="button"
          onClick={resend}
          disabled={sending || cooldownActive}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-sm border whitespace-nowrap',
            'border-warning/30 text-warning hover:bg-warning/10 hover:border-warning/50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
          )}
        >
          {sending ? 'Sending…' : cooldownActive ? `Wait ${Math.ceil(cooldownMs / 1000)}s` : sentAt ? 'Resend' : 'Resend email'}
        </button>
      </div>
    </BannerShell>
  )
}
