'use client'

import { motion } from 'motion/react'

interface PersonalityPickerProps {
  selected: string
  onSelect: (personality: string) => void
  industry: string
}

const PERSONALITIES = [
  { value: 'optimistic', label: 'Optimistic', emoji: '🌟', description: 'Warm, upbeat & positive. Customers love it.' },
  { value: 'balanced', label: 'Balanced', emoji: '⚖️', description: 'Professional & balanced. Straight to the point.' },
  { value: 'analytical', label: 'Analytical', emoji: '🧠', description: 'Detail-focused & thorough. Asks the right questions.' },
]

export default function PersonalityPicker({ selected, onSelect, industry }: PersonalityPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {PERSONALITIES.map((p, i) => {
        const isSelected = selected === p.value

        return (
          <motion.button
            key={p.value}
            onClick={() => onSelect(p.value)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 30,
              delay: i * 0.04,
            }}
            whileTap={{ scale: 0.97 }}
            className={`
              relative flex flex-col items-start gap-1 rounded-xl border px-4 py-4
              text-left backdrop-blur transition-all duration-200
              ${
                isSelected
                  ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
                  : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
              }
            `}
          >
            <motion.div
              animate={isSelected ? { scale: [1, 1.3, 1.1] } : { scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            >
              <span className="text-3xl leading-none">{p.emoji}</span>
            </motion.div>

            <span
              className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-white/80'}`}
            >
              {p.label}
            </span>

            <span className="text-xs leading-snug text-white/50">
              {p.description}
            </span>

            {/* Subtle selected indicator line at bottom */}
            {isSelected && (
              <motion.div
                layoutId="personality-indicator"
                className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-blue-500"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
