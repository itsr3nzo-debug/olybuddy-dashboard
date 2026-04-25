'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { Mail, Lock, ArrowRight, Sparkles } from 'lucide-react'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  const supabase = createClient()

  useEffect(() => {
    const err = searchParams.get('error')
    if (err === 'auth_callback_failed') {
      setError('Your sign-in link has expired or was already used.')
    } else if (err === 'session_expired') {
      setError('Your session timed out for security. Sign in again to continue.')
    } else if (err === 'unauthorized') {
      setError("You don't have access to that page.")
    } else if (err === 'password_reset_sent') {
      setError('If an account exists for that email, a reset link has been sent. Check your inbox.')
    }

    // Magic-link hash handler. Supabase's recovery email redirects to Site URL
    // with a #access_token=...&type=recovery fragment; the middleware then
    // pushes the user to /login (because they aren't authed yet). If this is
    // a PASSWORD RESET, hand off to /reset-password preserving the hash so
    // it can complete the flow. Otherwise treat as a sign-in magic link.
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
      const hash = window.location.hash
      const params = new URLSearchParams(hash.slice(1))
      const type = params.get('type')
      if (type === 'recovery') {
        window.location.replace('/reset-password' + hash)
        return
      }
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

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Don't leak whether the email exists
      setError(error.message.includes('Invalid login') ? 'Invalid email or password.' : error.message)
      setLoading(false)
    } else {
      router.replace('/dashboard')
    }
  }

  // Fallback: users who signed up before password-auth was enabled, or who
  // just prefer magic links, can get a one-time sign-in link sent here.
  async function handleMagicLinkFallback() {
    if (!email) {
      setError('Enter your email first to receive a sign-in link.')
      return
    }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setError(`If an account exists for ${email}, a sign-in link has been sent.`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0e1a]">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-indigo-500/20 blur-[100px] animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-emerald-500/15 blur-[100px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md mx-4 relative z-10"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/25">
              <Sparkles size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">Nexley AI</span>
          </div>
          <p className="text-slate-400 text-sm flex items-center justify-center gap-1.5">
            <Sparkles size={14} className="text-indigo-400" />
            AI Employee Dashboard
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl p-5 sm:p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl"
          style={{ background: 'rgba(30, 41, 59, 0.7)' }}
        >
          <h1 className="text-xl font-semibold mb-1 text-white">Sign in</h1>
          <p className="text-sm mb-6 text-slate-400">Email and password.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-300">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                />
              </div>
              <div className="mt-1.5 text-right">
                <a href="/forgot-password" className="text-xs text-indigo-400 hover:text-indigo-300">
                  Forgot password?
                </a>
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
              disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <>
                  Sign in <ArrowRight size={16} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleMagicLinkFallback}
              disabled={loading || !email}
              className="w-full py-2.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 border border-white/5 hover:border-white/10 transition-all disabled:opacity-50"
            >
              Email me a sign-in link instead
            </button>
          </form>
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
