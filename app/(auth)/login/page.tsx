'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { Phone, Mail, ArrowRight, Sparkles, Zap } from 'lucide-react'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [demoLoading, setDemoLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const supabase = createClient()

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'auth_callback_failed') {
      setError('Your sign-in link has expired or was already used. Please request a new one.')
    } else if (err === 'session_expired') {
      setError('Your session timed out for security. Sign in again to continue.')
    } else if (err === 'unauthorized') {
      setError('You don\'t have access to that page.')
    }

    // Supabase implicit magic-link flow: proxy.ts redirects unauthenticated
    // root → /login, but preserves the #access_token=... hash. Parse it and
    // set the session manually so we don't depend on detectSessionInUrl timing.
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
      const params = new URLSearchParams(window.location.hash.slice(1))
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
          if (error) {
            setError('Sign-in link expired. Request a new one.')
            return
          }
          window.history.replaceState({}, '', '/login')
          router.replace('/dashboard')
        })
      }
    }
  }, [searchParams, router, supabase])

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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0e1a]">
      {/* Animated background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px] animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-emerald-500/15 blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md mx-4 relative z-10"
      >
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Phone size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">Nexley AI</span>
          </div>
          <p className="text-slate-400 text-sm flex items-center justify-center gap-1.5">
            <Sparkles size={14} className="text-indigo-400" />
            AI Employee Dashboard
          </p>
        </motion.div>

        {/* Card with glassmorphism */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl"
          style={{ background: 'rgba(30, 41, 59, 0.7)' }}
        >
          {!submitted ? (
            <>
              <h1 className="text-xl font-semibold mb-1 text-white">Sign in</h1>
              <p className="text-sm mb-6 text-slate-400">
                We&apos;ll send a magic link to your email — no password needed.
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-slate-300">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm px-3 py-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20"
                  >
                    {error}
                  </motion.p>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <>
                      Send magic link
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>

                {/* Demo login removed for production — was exposing test credentials */}
              </form>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="text-center py-4"
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-indigo-500/10 border border-indigo-500/20">
                <Mail size={28} className="text-indigo-400" />
              </div>
              <h2 className="text-lg font-semibold mb-2 text-white">Check your email</h2>
              <p className="text-sm text-slate-400">
                We sent a magic link to <strong className="text-white">{email}</strong>.<br />
                Click it to sign in — link expires in 1 hour.
              </p>
            </motion.div>
          )}
        </motion.div>

        <p className="text-center text-sm mt-6 text-slate-400">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Sign up
          </a>
        </p>
      </motion.div>
    </div>
  )
}
