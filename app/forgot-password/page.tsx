'use client'

import { useState } from 'react'
import { Mail, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Field, Input } from '@/components/ui/input'

/**
 * /forgot-password — v2.
 *
 * Stripped of: glass card, blur, gradient bg, indigo hero ring around the
 * Mail icon. Replaced with the same plain dark-page + 360px-column shell
 * as /login.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
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
    <main className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[360px]">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft size={12} strokeWidth={1.75} /> Back to sign in
        </Link>

        {!submitted ? (
          <>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Reset your password
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 mb-6 leading-relaxed">
              Enter the email you signed up with. We&apos;ll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              {error && (
                <p className="text-xs px-3 py-2 rounded-sm border border-destructive/30 bg-destructive/8 text-destructive" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full h-10 inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        ) : (
          <div className="text-center">
            <Mail size={28} strokeWidth={1.5} className="text-muted-foreground/60 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              Check your inbox
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              If an account exists for{' '}
              <span className="font-mono tabular-nums text-foreground">{email}</span>, we&apos;ve sent a link to reset your password.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Link expires in 1 hour.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
