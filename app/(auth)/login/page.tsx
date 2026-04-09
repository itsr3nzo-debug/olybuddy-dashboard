'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSubmitted(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--sidebar-bg)' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 15a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 4.29h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 12a16 16 0 0 0 6 6l1.06-1.06a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 18.92z"/>
              </svg>
            </div>
            <span className="text-2xl font-bold text-white">Olybuddy</span>
          </div>
          <p className="text-slate-400 text-sm">AI Employee Dashboard</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8 shadow-2xl" style={{ background: 'var(--card-bg)' }}>
          {!submitted ? (
            <>
              <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--foreground)' }}>Sign in</h1>
              <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
                We&apos;ll send a magic link to your email — no password needed.
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 transition-all"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                    }}
                  />
                </div>

                {error && (
                  <p className="text-sm px-3 py-2 rounded-lg" style={{ color: 'var(--danger)', background: '#fef2f2' }}>
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {loading ? 'Sending...' : 'Send magic link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--accent-light)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold mb-2">Check your email</h2>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                We sent a magic link to <strong>{email}</strong>.<br />
                Click it to sign in — link expires in 1 hour.
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'var(--muted)' }}>
          Only registered clients can access this dashboard.
        </p>
      </div>
    </div>
  )
}
