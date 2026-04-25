'use client'

/**
 * Persistent banner shown to logged-in users whose email isn't verified yet.
 *
 * The dashboard layout reads clients.email_verified_at server-side and
 * renders this banner only when null. Internally we double-check via the
 * GET /api/auth/resend-verification endpoint so a user who verifies in
 * another tab sees the banner disappear without a hard refresh.
 *
 * Resend rate limit: 3/hr per client (enforced server-side). UI debounces
 * with a 60s cooldown after each successful send so people don't mash the
 * button.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Mail, X, Check } from 'lucide-react'

interface Props {
  email: string
}

export default function EmailVerificationBanner({ email }: Props) {
  const [verified, setVerified] = useState<boolean | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Re-check verified state on mount + every 30s (cheap — single SELECT).
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const r = await fetch('/api/auth/resend-verification', { method: 'GET', cache: 'no-store' })
        if (!r.ok) return
        const data = await r.json()
        if (!cancelled) setVerified(!!data.verified)
      } catch { /* network blip — silent */ }
    }
    check()
    const t = setInterval(check, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // Look for ?verify=ok set by the verify-email redirect — show a transient
  // success toast then strip the param from the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const v = params.get('verify')
    if (v === 'ok') {
      setVerified(true)
      // Clean the URL so a refresh doesn't replay the toast.
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

  // Hide once verified or user dismisses for the session
  if (verified === true || verified === null || dismissed) return null

  const cooldownMs = sentAt ? Math.max(0, 60_000 - (Date.now() - sentAt)) : 0
  const cooldownActive = cooldownMs > 0

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-sm"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <Mail size={16} className="text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-100">
              Verify your email
            </p>
            <p className="text-xs text-amber-200/70 mt-0.5">
              {sentAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check size={12} className="text-emerald-400" />
                  Verification email re-sent to <span className="font-medium text-amber-100">{email}</span>. Check your inbox (and spam).
                </span>
              ) : (
                <>We sent a verification link to <span className="font-medium text-amber-100">{email}</span>. Click it to secure your account and unlock things like cancelling your subscription.</>
              )}
            </p>
            {error && (
              <p className="text-xs text-red-300 mt-1.5">{error}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resend}
              disabled={sending || cooldownActive}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending\u2026' : cooldownActive ? `Wait ${Math.ceil(cooldownMs / 1000)}s` : sentAt ? 'Resend' : 'Resend email'}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss for this session"
              className="text-amber-200/50 hover:text-amber-100 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
