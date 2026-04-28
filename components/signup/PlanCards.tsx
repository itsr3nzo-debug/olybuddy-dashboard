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
  'Custom voice & tone, trained on your past messages',
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
    // Short sub-line so the price block has the same vertical rhythm
    // as the other two cards. The "then £599/mo" detail lives in the
    // description + footnote where it has room to breathe.
    priceSub: 'one-time',
    description: 'Try the full-power plan for 5 days, then £599/mo from Day 6. Cancel anytime.',
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
                // flex column + h-full so all three cards share the
                // tallest sibling's height (grid stretches; flex-col
                // inside lets us push the CTA + footnote to the bottom
                // via mt-auto so the buttons line up across cards
                // regardless of feature-list length).
                'group relative h-full flex flex-col rounded-lg border bg-card overflow-hidden p-5 sm:p-6 text-left transition-colors',
                'hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background',
                plan.highlight
                  ? 'border-primary shadow-[inset_2px_0_0_0_var(--primary)]'
                  : isSelected
                    ? 'border-primary'
                    : 'border-border',
              ].join(' ')}
            >
              {/* Eyebrow chip — fixed-height row so all three eyebrows
                  sit on the same baseline across cards. */}
              <div className="mb-4 h-5 flex items-center">
                <span
                  className={[
                    'inline-flex items-center h-5 text-[10.5px] font-semibold uppercase tracking-wider px-2 rounded-sm',
                    plan.highlight
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {plan.eyebrow}
                </span>
              </div>

              {/* Price — fixed vertical rhythm so all three price blocks
                  occupy the same height regardless of digit count or
                  sub-line length. */}
              <div className="mb-4">
                <div className="flex items-baseline gap-2 h-10">
                  <span className="font-mono tabular-nums text-3xl sm:text-4xl font-semibold text-foreground tracking-tight leading-none">
                    {plan.priceMain}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2 h-4 leading-none">
                  {plan.priceSub}
                </p>
              </div>

              {/* Description — clamp to two lines so all cards have
                  matching description height. */}
              <p className="text-[13px] text-foreground/85 leading-snug mb-5 line-clamp-2 min-h-[2.5em]">
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

              {/* mt-auto pushes CTA + footnote to the bottom of the card
                  so they line up across all three regardless of how many
                  features are in the list above. */}
              <div className="mt-auto pt-2">
                <div
                  className={[
                    'h-9 rounded-md flex items-center justify-center text-[13px] font-medium transition-colors mb-3 px-2',
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
              </div>
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
