'use client'

import { useState } from 'react'
import { Mail, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    // Route through our own API so we can (a) pick the correct origin for the
    // reset link regardless of Supabase Site URL config, and (b) deliver via
    // Resend instead of Supabase's rate-limited default mailer.
    try {
      await fetch('/api/auth/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
    } catch (err) {
      console.warn('request-reset failed', err)
    }
    setSubmitted(true)
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-6">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
        <div className="rounded-2xl p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl bg-slate-900/70">
          {!submitted ? (
            <>
              <h1 className="text-xl font-semibold text-white mb-1">Reset your password</h1>
              <p className="text-sm text-slate-400 mb-6">
                Enter the email you signed up with. We&apos;ll send you a link to set a new password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-indigo-500/10 border border-indigo-500/20">
                <Mail size={28} className="text-indigo-400" />
              </div>
              <h2 className="text-lg font-semibold text-white mb-2">Check your inbox</h2>
              <p className="text-sm text-slate-400">
                If an account exists for <strong className="text-white">{email}</strong>,
                we&apos;ve sent a link to reset your password.
                Link expires in 1 hour.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
