'use client'

import { motion } from 'motion/react'
import { Check, Star } from 'lucide-react'
import { PLAN_DETAILS, INDUSTRIES } from '@/lib/stripe'

interface PlanCardsProps {
  selected: string
  onSelect: (plan: string) => void
  industry: string
}

const PLAN_ORDER = ['trial', 'starter', 'pro', 'enterprise'] as const

export default function PlanCards({ selected, onSelect, industry }: PlanCardsProps) {
  const industryLabel = INDUSTRIES.find((i) => i.value === industry)?.label ?? 'Employee'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {PLAN_ORDER.map((planKey, i) => {
        const plan = PLAN_DETAILS[planKey]
        if (!plan) return null

        const isSelected = selected === planKey
        const isPro = planKey === 'pro'
        const isTrial = planKey === 'trial'

        return (
          <motion.button
            key={planKey}
            onClick={() => onSelect(planKey)}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
              delay: i * 0.06,
            }}
            whileTap={{ scale: 0.98 }}
            className={`
              relative flex flex-col rounded-2xl border p-5 text-left
              backdrop-blur transition-all duration-200
              ${
                isSelected
                  ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_24px_rgba(59,130,246,0.15)]'
                  : isPro
                    ? 'border-blue-500/30 bg-white/5 hover:border-blue-500/50 hover:bg-white/[0.07]'
                    : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
              }
            `}
          >
            {/* Most Popular badge */}
            {isPro && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  <Star className="h-3 w-3" fill="currentColor" />
                  Most Popular
                </div>
              </div>
            )}

            {/* Plan name */}
            <p
              className={`text-sm font-medium ${
                isSelected ? 'text-blue-400' : 'text-white/60'
              }`}
            >
              {plan.name}
            </p>

            {/* Price */}
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">{plan.price}</span>
              <span className="text-sm text-white/40">{plan.period}</span>
            </div>

            {/* Divider */}
            <div className="my-4 h-px bg-white/10" />

            {/* Features */}
            <ul className="flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      isSelected ? 'text-blue-400' : 'text-emerald-400/70'
                    }`}
                    strokeWidth={2.5}
                  />
                  <span className="text-sm leading-snug text-white/70">{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <div
              className={`
                mt-5 rounded-lg py-2.5 text-center text-sm font-semibold transition-colors
                ${
                  isSelected
                    ? 'bg-blue-500 text-white'
                    : 'bg-white/10 text-white/60'
                }
              `}
            >
              {isTrial
                ? `Start your AI ${industryLabel}`
                : 'Continue to payment'}
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}
