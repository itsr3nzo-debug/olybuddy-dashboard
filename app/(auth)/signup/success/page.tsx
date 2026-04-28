'use client'

import { motion } from 'motion/react'
import { CheckCircle, ArrowRight, Server, Smartphone, MessageSquare, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Post-payment landing — v2.
 *
 * Stripped of:
 * - Indigo + emerald blur ambient circles + grid background pattern
 * - Indigo→indigo Sparkles tile + gradient submit button
 * - rounded-2xl glass card, backdrop-blur-xl
 * - Big rounded-2xl emerald checkmark tile
 * - "Welcome aboard" marketing copy and gradient hero
 *
 * Replaced with:
 * - Plain dark page bg, centered 480px column
 * - Workspace mark + brand name (matches /login)
 * - Single emerald check inline with "Payment received" title
 * - Three numbered next-step rows, hairline-bordered, mono digits
 * - Solid primary CTA to /login
 *
 * Behavioural unchanged: pre-auth check redirects to /onboarding,
 * 2.5s safety timeout for slow Supabase, lightweight loading state.
 */
export default function SignupSuccessPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    const timeoutId = setTimeout(() => setChecking(false), 2500)
    supabase.auth.getUser().then(({ data }) => {
      clearTimeout(timeoutId)
      if (data?.user) {
        router.replace('/onboarding')
      } else {
        setChecking(false)
      }
    }).catch(() => {
      clearTimeout(timeoutId)
      setChecking(false)
    })
    return () => clearTimeout(timeoutId)
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-muted-foreground mb-3 mx-auto" />
          <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-[480px]"
      >
        {/* Wordmark only — consistent with login + signup chrome */}
        <div className="text-center mb-10">
          <span className="text-xl font-semibold text-foreground tracking-tight">
            Nexley AI
          </span>
        </div>

        {/* Status row + title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-2 h-6 rounded-sm border border-success/30 bg-success/8 text-success text-xs font-medium">
            <CheckCircle size={12} strokeWidth={2} />
            Payment received
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-foreground tracking-tight">
            You&apos;re on your trial.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">£19.99</span> charged
            <span className="text-muted-foreground/60"> · </span>
            5-day trial active
            <span className="text-muted-foreground/60"> · </span>
            <span className="font-mono tabular-nums">£599/mo</span> auto-bills on Day 6 unless you cancel.
          </p>
        </div>

        {/* Steps */}
        <ol className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border mb-6">
          <Step
            n={1}
            icon={<Server size={14} strokeWidth={1.5} />}
            title="We're building your AI Employee right now"
            body="A dedicated server is spinning up. Takes about 15 minutes — no action needed."
          />
          <Step
            n={2}
            icon={<Smartphone size={14} strokeWidth={1.5} />}
            title="Pair your WhatsApp"
            body="Sign in and you'll see a QR code. Scan it with WhatsApp Business on your phone."
          />
          <Step
            n={3}
            icon={<MessageSquare size={14} strokeWidth={1.5} />}
            title="Connect Gmail, Calendar, Xero"
            body="One click each from the Integrations tab. Your AI Employee uses them automatically."
          />
        </ol>

        <Link
          href="/login"
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign in to your dashboard
          <ArrowRight size={14} strokeWidth={1.75} />
        </Link>

        <p className="text-center text-xs mt-6 text-muted-foreground">
          Questions? Email{' '}
          <a href="mailto:hello@nexley.ai" className="text-foreground hover:underline">
            hello@nexley.ai
          </a>
          . You&apos;ll get a receipt email from Stripe within a minute.
        </p>
      </motion.div>
    </div>
  )
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span
        aria-hidden
        className="shrink-0 size-6 rounded-full inline-flex items-center justify-center text-[11px] font-medium font-mono tabular-nums bg-muted text-muted-foreground border border-border mt-0.5"
      >
        {n}
      </span>
      <span className="text-muted-foreground/60 mt-1">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground tracking-tight">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
      </div>
    </li>
  )
}
