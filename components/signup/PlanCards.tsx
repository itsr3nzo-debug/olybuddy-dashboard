'use client'

import { motion } from 'motion/react'
import { Check, Sparkles } from 'lucide-react'
import { useEffect } from 'react'

interface PlanCardsProps {
  selected: string
  onSelect: (plan: string) => void
  industry: string
}

/**
 * Single offer card. We used to show a 3-tier picker (Trial / Employee /
 * Voice) but all three routed to the same £20 onboarding + £599/mo flow —
 * misleading UX for anyone who picked "Voice — £999/mo". Product is a
 * single all-inclusive tier, so the signup surface now mirrors that.
 *
 * The parent form still tracks `selected` (stays as 'trial' internally so
 * the POST body + CTA label keep working); we just display one beautifully
 * clear offer instead of three conflicting cards.
 */
const FEATURES = [
  'AI Employee answering every WhatsApp message 24/7',
  'Every inbound phone call answered by Ava (our voice AI)',
  'Automated follow-ups, quotes, bookings, review requests',
  'Dedicated private server provisioned just for your business',
  'Connect Gmail, Calendar, Xero, HubSpot from your dashboard',
  'Cancel in two clicks from your dashboard — no awkward calls',
]

export default function PlanCards({ selected, onSelect }: PlanCardsProps) {
  // Auto-select 'trial' — this is the only plan code the backend now offers.
  // Keeping a selected value means the parent form's Continue button enables.
  useEffect(() => {
    if (selected !== 'trial') onSelect('trial')
  }, [selected, onSelect])

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative rounded-3xl border border-indigo-500/30 p-5 sm:p-8 lg:p-10 overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 100%)',
        }}
      >
        {/* subtle ambient glow */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full bg-indigo-500/20 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-violet-500/15 blur-[80px]" />

        {/* "5-Day Trial · No risk" pill */}
        <div className="relative flex justify-center mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-indigo-500/30">
            <Sparkles size={12} fill="currentColor" />
            5-Day Trial · No risk
          </div>
        </div>

        {/* Price block */}
        <div className="relative text-center mb-8">
          <p className="text-xs uppercase tracking-widest text-white/50 mb-3">
            Your AI Employee
          </p>
          <div className="flex items-baseline justify-center gap-2 mb-2">
            <span className="text-6xl font-bold text-white tabular-nums">£19.99</span>
            <span className="text-lg text-white/60">today</span>
          </div>
          <p className="text-sm text-white/60">
            Then <span className="font-semibold text-white">£599/month</span> from Day 6 — cancel anytime during the trial
          </p>
        </div>

        {/* Features */}
        <ul className="relative space-y-3 mb-8">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0 rounded-full bg-emerald-500/15 p-0.5">
                <Check size={14} className="text-emerald-400" strokeWidth={3} />
              </div>
              <span className="text-sm text-white/80 leading-snug">{feature}</span>
            </li>
          ))}
        </ul>

        {/* Divider + footnote (the Continue button lives in the parent form) */}
        <div className="relative h-px bg-white/10 mb-5" />
        <p className="relative text-center text-xs text-white/50">
          £19.99 charged securely by Stripe. You&apos;ll get a full 5-day trial on a dedicated server.
          On Day 6 your card is auto-billed £599 unless you cancel first.
        </p>
      </motion.div>
    </div>
  )
}
