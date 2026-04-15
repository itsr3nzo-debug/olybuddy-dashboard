'use client'

import { motion } from 'motion/react'
import { Check, Star, Phone } from 'lucide-react'
import { PLAN_DETAILS } from '@/lib/stripe'

interface PlanCardsProps {
  selected: string
  onSelect: (plan: string) => void
  industry: string
}

const PLAN_ORDER = ['trial', 'employee', 'voice'] as const

export default function PlanCards({ selected, onSelect }: PlanCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
      {PLAN_ORDER.map((planKey, i) => {
        const plan = PLAN_DETAILS[planKey]
        if (!plan) return null

        const isSelected = selected === planKey
        const isTrial = planKey === 'trial'
        const isEmployee = planKey === 'employee'
        const isVoice = planKey === 'voice'

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
              relative flex flex-col rounded-2xl border p-6 text-left
              backdrop-blur transition-all duration-200
              ${
                isSelected
                  ? isVoice
                    ? 'border-violet-500 bg-violet-500/10 shadow-[0_0_28px_rgba(139,92,246,0.18)]'
                    : 'border-blue-500 bg-blue-500/10 shadow-[0_0_28px_rgba(59,130,246,0.18)]'
                  : isEmployee
                    ? 'border-blue-500/30 bg-white/5 hover:border-blue-500/50 hover:bg-white/[0.07]'
                    : isVoice
                      ? 'border-violet-500/20 bg-white/5 hover:border-violet-500/40 hover:bg-white/[0.07]'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
              }
            `}
          >
            {/* Most Popular badge on AI Employee */}
            {isEmployee && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="flex items-center gap-1 rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  <Star className="h-3 w-3" fill="currentColor" />
                  Most Popular
                </div>
              </div>
            )}

            {/* Includes Voice badge */}
            {isVoice && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <div className="flex items-center gap-1.5 rounded-full bg-violet-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                  <Phone className="h-3 w-3" />
                  Includes Voice
                </div>
              </div>
            )}

            {/* Plan name row */}
            <div className="flex items-center gap-2 mb-1">
              {isVoice && (
                <div className={`rounded-lg p-1.5 ${isSelected ? 'bg-violet-500/20' : 'bg-white/[0.06]'}`}>
                  <Phone className={`h-4 w-4 ${isSelected ? 'text-violet-400' : 'text-white/40'}`} />
                </div>
              )}
              <p className={`text-sm font-semibold tracking-wide ${
                isSelected
                  ? isVoice ? 'text-violet-400' : 'text-blue-400'
                  : 'text-white/60'
              }`}>
                {plan.name}
              </p>
            </div>

            {/* Subtitle */}
            <p className="text-xs text-white/38 mb-4 leading-snug">{plan.subtitle}</p>

            {/* Price */}
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-white">{plan.price}</span>
              <span className="text-sm text-white/40">{plan.period}</span>
            </div>

            {/* Divider */}
            <div className={`my-4 h-px ${isSelected && isVoice ? 'bg-violet-500/20' : isSelected ? 'bg-blue-500/20' : 'bg-white/10'}`} />

            {/* Features */}
            <ul className="flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                      isSelected
                        ? isVoice ? 'text-violet-400' : 'text-blue-400'
                        : 'text-emerald-400/70'
                    }`}
                    strokeWidth={2.5}
                  />
                  <span className="text-sm leading-snug text-white/70">{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA button */}
            <div className={`
              mt-6 rounded-xl py-3 text-center text-sm font-semibold transition-colors
              ${
                isSelected
                  ? isVoice
                    ? 'bg-violet-500 text-white'
                    : 'bg-blue-500 text-white'
                  : isVoice
                    ? 'border border-violet-500/25 bg-violet-500/8 text-violet-300/60'
                    : 'bg-white/8 text-white/55'
              }
            `}>
              {isTrial
                ? 'Try Nexley AI — 5 days'
                : isVoice
                  ? 'Hire AI Employee + Voice'
                  : 'Hire your AI Employee'}
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}
