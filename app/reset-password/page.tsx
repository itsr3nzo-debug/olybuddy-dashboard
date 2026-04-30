'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Check } from 'lucide-react'
import Link from 'next/link'
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'
import { Input } from '@/components/ui/input'

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const search = useSearchParams()

  useEffect(() => {
    if (typeof window === 'undefined') return
    let isMounted = true
    const supabase = createClient()

    // Path 1 — our custom route sends ?token_hash=...&type=recovery
    // Exchange via verifyOtp to mint a session locally. No server-side
    // redirect allowlist involved.
    //
    // IMPORTANT: do NOT pass `email` here. Supabase rejects
    //   "Only the token_hash and type should be provided"
    // when all three arrive together — token_hash is already self-identifying.
    const tokenHash = search?.get('token_hash')
    const type = (search?.get('type') as 'recovery' | 'email' | undefined) || 'recovery'
    if (tokenHash) {
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type })
        .then(({ error }) => {
          if (!isMounted) return
          if (error) setError('Reset link expired or already used. Request a new one.')
          else {
            setReady(true)
            window.history.replaceState({}, '', '/reset-password')
          }
        })
      return () => { isMounted = false }
    }

    // Path 2 — legacy Supabase recovery redirect with #access_token=… hash.
    const hash = window.location.hash
    if (hash.includes('access_token')) {
      const p = new URLSearchParams(hash.slice(1))
      const access_token = p.get('access_token')
      const refresh_token = p.get('refresh_token')
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
          if (!isMounted) return
          if (error) setError('Reset link expired or already used. Request a new one.')
          else {
            setReady(true)
            window.history.replaceState({}, '', '/reset-password')
          }
        })
        return () => { isMounted = false }
      }
    }

    // No token anywhere → user hit /reset-password directly.
    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return
      if (data.user) setReady(true)
      else setError('You need to click the reset link from your email first.')
    })
    return () => { isMounted = false }
  }, [search])

  // Devil's-advocate fix P2 #2: reset flow was running its own legacy
  // 10-char/digit-only validation, bypassing the strengthened policy in
  // /api/signup. Use the shared validatePassword so reset-password,
  // signup, and any future password-set flow enforce identical rules.
  const passwordCheck = validatePassword(password)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (passwordCheck.error) {
      setError(passwordCheck.error)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setDone(true)
    // Invalidate all OTHER sessions so an attacker who stole the old password
    // gets kicked out on next request.
    try { await fetch('/api/auth/revoke-other-sessions', { method: 'POST' }) } catch (err) {
      console.warn('Failed to revoke other sessions:', err)
    }
    setTimeout(() => router.replace('/dashboard'), 1500)
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[360px]">
        {done ? (
          <div className="text-center">
            <Check size={28} strokeWidth={1.75} className="text-success mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Password updated
            </h2>
            <p className="text-sm text-muted-foreground mt-2">Signing you in…</p>
          </div>
        ) : !ready ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{error || 'Checking reset link…'}</p>
            {error && (
              <Link
                href="/forgot-password"
                className="inline-block mt-4 text-sm text-foreground hover:underline"
              >
                Request a new reset link →
              </Link>
            )}
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Set a new password
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 mb-6 leading-relaxed">
              At least {PASSWORD_MIN_LENGTH} characters with upper, lower, number, and a symbol.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  required
                  autoFocus
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                />
                {password && passwordCheck.error && (
                  <p className="text-xs text-warning mt-1.5">{passwordCheck.error}</p>
                )}
              </div>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm password"
                required
                autoComplete="new-password"
              />
              {error && (
                <p className="text-xs px-3 py-2 rounded-sm border border-destructive/30 bg-destructive/8 text-destructive" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || !password || !confirm}
                className="w-full h-10 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
