'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Lock, Check } from 'lucide-react'
import Link from 'next/link'
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

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
    <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl bg-slate-900/70">
          {done ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-emerald-500/10 border border-emerald-500/20">
                <Check size={28} className="text-emerald-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">Password updated</h2>
              <p className="text-sm text-slate-400">Signing you in…</p>
            </div>
          ) : !ready ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400">{error || 'Checking reset link…'}</p>
              {error && (
                <Link href="/forgot-password" className="inline-block mt-4 text-sm text-indigo-400 hover:text-indigo-300">
                  Request a new reset link →
                </Link>
              )}
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-white mb-1">Set a new password</h1>
              <p className="text-sm text-slate-400 mb-6">At least {PASSWORD_MIN_LENGTH} characters with upper, lower, number, and a symbol.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="New password"
                    required
                    autoFocus
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_LENGTH}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </div>
                {/* Live policy feedback — same rules the validator enforces. */}
                {password && passwordCheck.error && (
                  <p className="text-xs text-amber-400 -mt-2">{passwordCheck.error}</p>
                )}
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Confirm password"
                    required
                    autoComplete="new-password"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !password || !confirm}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                >
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
