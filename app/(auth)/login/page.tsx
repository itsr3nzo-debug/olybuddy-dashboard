'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'motion/react'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Field, Input } from '@/components/ui/input'

/**
 * /login — v2.
 *
 * Stripped of:
 * - Indigo blur ambient circles + grid background pattern
 * - Sparkles tile + Sparkles "AI Employee Dashboard" eyebrow
 * - rounded-2xl glass card with backdrop-blur-xl
 * - Indigo→indigo gradient submit button with shadow
 * - "Email and password." sub-line (was placeholder copy)
 *
 * Replaced with:
 * - Plain dark page bg, no circles
 * - Centered 360px column
 * - Small workspace mark (24px monogram tile) + sentence-case title
 * - Hairline-bordered fields via the new Input + Field primitives
 * - Solid primary submit button with right-arrow
 * - Magic-link fallback as a quiet ghost button
 *
 * Behavioural unchanged: password sign-in, magic-link fallback, hash-token
 * recovery handler for ?type=recovery, error param sniffing.
 */
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
  const [info, setInfo] = useState('')
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
      setInfo('If an account exists for that email, a reset link has been sent. Check your inbox.')
    }

    // Magic-link / recovery hash handler — unchanged from v1.
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
    setInfo('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message.includes('Invalid login') ? 'Invalid email or password.' : error.message)
      setLoading(false)
    } else {
      router.replace('/dashboard')
    }
  }

  async function handleMagicLinkFallback() {
    if (!email) {
      setError('Enter your email first to receive a sign-in link.')
      return
    }
    setLoading(true)
    setError('')
    setInfo('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setInfo(`If an account exists for ${email}, a sign-in link has been sent.`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-[360px]"
      >
        {/* Wordmark only — matches the signup flow chrome */}
        <div className="text-center mb-10">
          <span className="text-xl font-semibold text-foreground tracking-tight">
            Nexley AI
          </span>
        </div>

        {/* Form */}
        <div className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Welcome back. Use your email and password to continue.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <div className="mt-1.5 text-right">
                <a
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </a>
              </div>
            </Field>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs px-3 py-2 rounded-sm border border-destructive/30 bg-destructive/8 text-destructive"
                role="alert"
              >
                {error}
              </motion.p>
            )}
            {info && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs px-3 py-2 rounded-sm border border-border bg-muted/40 text-muted-foreground"
              >
                {info}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {loading ? (
                <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={14} strokeWidth={1.75} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleMagicLinkFallback}
              disabled={loading || !email}
              className="w-full h-9 inline-flex items-center justify-center rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Email me a sign-in link instead
            </button>
          </form>
        </div>

        <p className="text-center text-sm mt-8 text-muted-foreground">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="text-foreground font-medium hover:underline">
            Sign up
          </a>
        </p>
      </motion.div>
    </div>
  )
}
