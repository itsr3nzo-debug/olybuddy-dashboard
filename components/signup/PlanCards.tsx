'use client'

import { motion } from 'motion/react'
import { Check } from 'lucide-react'

interface PlanCardsProps {
  selected: string
  onSelect: (plan: string) => void
  industry: string
}

/**
 * PlanCards — v3.
 *
 * Three-tier plan picker:
 *   1. Trial      — £19.99 for 5 days, converts to £599/mo
 *   2. Full Power — £599/mo (the standard offering, "looks worth it")
 *   3. Enterprise — £2,995/mo for teams of 10+
 *
 * The voice-call (Ava) feature was removed at the operator's request:
 * we're not pitching inbound-phone-handling anymore — WhatsApp is the
 * primary surface, voice is a separate add-on / not part of the
 * standard sign-up offer.
 *
 * Default selection is `trial` (the entry point). Operators can pick
 * `pro` or `enterprise` directly to skip the trial and bill straight
 * away.
 */

type PlanId = 'trial' | 'pro' | 'enterprise'

interface Plan {
  id: PlanId
  eyebrow: string
  priceMain: string
  priceSub: string
  description: string
  features: string[]
  cta: string
  highlight: boolean
  footnote: string
}

const TRIAL_FEATURES = [
  'AI Employee answering every WhatsApp message 24/7',
  'Automated follow-ups, quotes, bookings, review requests',
  'Dedicated private server provisioned just for your business',
  'Connect Gmail, Calendar, Xero, HubSpot from your dashboard',
  'Cancel in two clicks — no awkward calls',
]

const PRO_FEATURES = [
  'Everything in the 5-day trial',
  'Full-power AI Employee — unlimited WhatsApp + email handling',
  'Custom writing tone — learns your style from past messages',
  'Priority routing — replies in under 30 seconds, 24/7',
  'Unlimited integrations (Gmail, Calendar, Xero, HubSpot, Fergus)',
  'Vault: upload contracts, quotes, spec sheets, past jobs',
  'Heartbeat reports — daily brief on what your AI did',
  'Priority human support, dedicated success manager',
]

const ENTERPRISE_FEATURES = [
  'Everything in Full Power, for teams of 10+',
  'Multi-seat dashboard with role-based access',
  'Per-team AI Employees — one per region, brand, or department',
  'Custom integrations & on-prem connectors',
  'SLA-backed uptime, dedicated infrastructure',
  'Quarterly business reviews + named account manager',
  'Custom contracts, invoicing, and procurement on request',
]

const PLANS: Plan[] = [
  {
    id: 'trial',
    eyebrow: '5-day trial · no risk',
    priceMain: '£19.99',
    priceSub: 'today, then £599/mo from Day 6',
    description: 'Try the full-power plan for 5 days. Cancel anytime, no questions.',
    features: TRIAL_FEATURES,
    cta: 'Start 5-day trial',
    highlight: false,
    footnote: '£19.99 charged securely by Stripe. On Day 6 your card is auto-billed £599 unless you cancel first.',
  },
  {
    id: 'pro',
    eyebrow: 'Most popular',
    priceMain: '£599',
    priceSub: 'per month',
    description: 'Full power. Everything you need to run your business on autopilot.',
    features: PRO_FEATURES,
    cta: 'Get Full Power',
    highlight: true,
    footnote: 'Billed monthly. Cancel anytime from your dashboard.',
  },
  {
    id: 'enterprise',
    eyebrow: 'Teams of 10+',
    priceMain: '£2,995',
    priceSub: 'per month',
    description: 'Multi-seat AI workforce for growing teams and enterprises.',
    features: ENTERPRISE_FEATURES,
    cta: 'Choose Enterprise',
    highlight: false,
    footnote: 'Custom contracts available. Talk to us about volume pricing & on-prem options.',
  },
]

export default function PlanCards({ selected, onSelect }: PlanCardsProps) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan, idx) => {
          const isSelected = selected === plan.id
          return (
            <motion.button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
              className={[
                'relative rounded-lg border bg-card overflow-hidden p-5 sm:p-6 text-left transition-colors',
                'hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background',
                plan.highlight
                  ? 'border-primary shadow-[inset_2px_0_0_0_var(--primary)]'
                  : isSelected
                    ? 'border-primary'
                    : 'border-border',
              ].join(' ')}
            >
              {/* Eyebrow chip */}
              <div className="mb-4">
                <span
                  className={[
                    'inline-flex items-center text-[10.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm',
                    plan.highlight
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {plan.eyebrow}
                </span>
              </div>

              {/* Price */}
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono tabular-nums text-3xl sm:text-4xl font-semibold text-foreground tracking-tight leading-none">
                    {plan.priceMain}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {plan.priceSub}
                </p>
              </div>

              {/* Description */}
              <p className="text-[13px] text-foreground/85 leading-snug mb-4">
                {plan.description}
              </p>

              {/* Features */}
              <ul className="space-y-2 mb-5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      size={13}
                      strokeWidth={2.25}
                      className="mt-[3px] shrink-0 text-success"
                      aria-hidden
                    />
                    <span className="text-[12.5px] text-foreground/80 leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA — purely visual; click handler is on the whole card */}
              <div
                className={[
                  'h-9 rounded-md flex items-center justify-center text-[13px] font-medium transition-colors mb-3',
                  plan.highlight || isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border text-foreground',
                ].join(' ')}
              >
                {isSelected ? 'Selected ✓' : plan.cta}
              </div>

              {/* Footnote */}
              <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                {plan.footnote}
              </p>
            </motion.button>
          )
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground mt-5">
        All plans include UK-based support. VAT applied at checkout where applicable.
      </p>
    </div>
  )
}
