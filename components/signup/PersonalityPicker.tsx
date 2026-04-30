'use client'

import { motion } from 'motion/react'
import { Sun, Scale, Brain, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PersonalityPickerProps {
  selected: string
  onSelect: (personality: string) => void
  industry: string
}

interface Personality {
  value: string
  label: string
  Icon: LucideIcon
  description: string
}

/**
 * PersonalityPicker — v2.
 *
 * Stripped of:
 * - Emoji (🌟 ⚖️ 🧠) — replaced with Lucide icons
 * - rounded-xl + bg-white/5 + backdrop-blur card → hairline-bordered card
 * - Blue-500 accent → primary navy via tokens
 *
 * Replaces the 3-card vertical picker with the same shape but new chrome.
 */
const PERSONALITIES: Personality[] = [
  {
    value: 'optimistic',
    label: 'Optimistic',
    Icon: Sun,
    description: 'Warm, upbeat and positive. Customers love it.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    Icon: Scale,
    description: 'Professional and balanced. Straight to the point.',
  },
  {
    value: 'analytical',
    label: 'Analytical',
    Icon: Brain,
    description: 'Detail-focused and thorough. Asks the right questions.',
  },
]

export default function PersonalityPicker({ selected, onSelect }: PersonalityPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {PERSONALITIES.map((p, i) => {
        const isSelected = selected === p.value

        return (
          <motion.button
            key={p.value}
            type="button"
            onClick={() => onSelect(p.value)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.2,
              delay: i * 0.04,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className={cn(
              'group relative flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-primary bg-primary/8 shadow-[inset_2px_0_0_0_var(--primary)]'
                : 'border-border bg-card hover:bg-muted/40 hover:border-border',
            )}
            aria-pressed={isSelected}
          >
            <p.Icon
              size={18}
              strokeWidth={1.5}
              className={cn(
                'shrink-0',
                isSelected ? 'text-primary' : 'text-muted-foreground',
              )}
            />

            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  'text-sm font-semibold tracking-tight',
                  isSelected ? 'text-foreground' : 'text-foreground/85',
                )}
              >
                {p.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {p.description}
              </p>
            </div>

            {isSelected && (
              <Check
                size={14}
                strokeWidth={2}
                className="text-primary shrink-0"
                aria-hidden
              />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
