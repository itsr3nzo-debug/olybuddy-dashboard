'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Lock, Check } from 'lucide-react'
import Link from 'next/link'

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

  useEffect(() => {
    // Supabase password-reset email lands here with #access_token=… hash.
    // Claim the session so we can call updateUser() below.
    if (typeof window === 'undefined') return
    let isMounted = true
    const supabase = createClient()
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
    // User hit /reset-password directly without a valid link → send back
    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return
      if (data.user) setReady(true)
      else setError('You need to click the reset link from your email first.')
    })
    return () => { isMounted = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (!/\d/.test(password)) {
      setError('Password must contain at least one number.')
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
              <p className="text-sm text-slate-400 mb-6">Minimum 10 characters, must include a number.</p>
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
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </div>
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
