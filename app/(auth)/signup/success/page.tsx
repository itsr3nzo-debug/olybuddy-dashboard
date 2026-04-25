'use client'

import { motion } from 'motion/react'
import { CheckCircle, Sparkles, ArrowRight, Server, Smartphone, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Post-payment landing. The customer just paid £20, their card is on file,
 * their 5-day trial is active, and the webhook has kicked off VPS provisioning.
 * We don't bother verifying the Stripe session_id server-side — the webhook
 * is the source of truth.
 *
 * The signup page pre-signs them in BEFORE redirecting to Stripe so the
 * session cookie survives the round-trip. If we detect an auth'd session
 * here, we skip the "sign in to your dashboard" step entirely and redirect
 * straight to /onboarding. Falls back to the reassuring landing card + manual
 * sign-in if the pre-auth failed (network blip, etc).
 */
export default function SignupSuccessPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    // Safety timeout — if Supabase is slow/down, never leave them spinning.
    const timeoutId = setTimeout(() => setChecking(false), 2500)
    supabase.auth.getUser().then(({ data }) => {
      clearTimeout(timeoutId)
      if (data?.user) {
        // They're signed in from the pre-Checkout sign-in — skip the card,
        // go straight to the WhatsApp pairing / onboarding flow. Webhook
        // handles provisioning in the background.
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

  // While we check auth, show a lightweight loading state (no flash of the
  // full card). If they're auth'd, the redirect fires before this renders.
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a]">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-slate-400 text-sm">Taking you to your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0a0e1a] py-10">
      {/* Ambient background */}
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
        className="w-full max-w-xl mx-4 relative z-10"
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
              <Sparkles size={22} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-3xl font-bold text-white tracking-tight">Nexley AI</span>
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl p-8 shadow-2xl border border-white/[0.08] backdrop-blur-xl text-center"
          style={{ background: 'rgba(30, 41, 59, 0.7)' }}
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.4 }}
          >
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle size={32} className="text-emerald-400" />
            </div>
          </motion.div>

          <h1 className="text-2xl font-semibold mb-2 text-white">
            Payment received — welcome aboard
          </h1>
          <p className="text-sm text-slate-400 mb-8">
            £19.99 charged · 5-day trial active · £599/mo auto-bills on Day 6 unless you cancel
          </p>

          {/* Next steps timeline */}
          <div className="text-left space-y-4 mb-8">
            <StepItem
              icon={<Server size={16} />}
              title="We're building your AI Employee right now"
              body="A dedicated Hetzner server is spinning up just for you. Takes about 15 minutes — happens in the background, no action needed."
            />
            <StepItem
              icon={<Smartphone size={16} />}
              title="Next: pair your WhatsApp"
              body="Sign in, and you'll be taken to a page with a QR code. Scan it with WhatsApp Business on your phone — one scan and you're live."
            />
            <StepItem
              icon={<MessageSquare size={16} />}
              title="Then: connect Gmail, Calendar, Xero"
              body="One click each from the Integrations tab. Your AI Employee uses them automatically once connected."
            />
          </div>

          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold text-white transition-all bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
          >
            Sign in to your dashboard
            <ArrowRight size={16} />
          </Link>
        </motion.div>

        <p className="text-center text-xs mt-6 text-slate-500">
          Questions? Email <a href="mailto:hello@nexley.ai" className="text-indigo-400 hover:text-indigo-300">hello@nexley.ai</a>.
          You&apos;ll also get a receipt email from Stripe within a minute.
        </p>
      </motion.div>
    </div>
  )
}

function StepItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-white mb-0.5">{title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
      </div>
    </div>
  )
}
