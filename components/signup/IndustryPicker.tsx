'use client'

import { useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'motion/react'
import {
  Wrench,
  Zap,
  Hammer,
  Trees,
  Home,
  Sparkles,
  Scissors,
  Scale,
  Flower2,
  Fence,
  LayoutGrid,
  Sofa,
  TreePine,
  Heart,
  Building2,
  Users,
  Dog,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface IndustryPickerProps {
  selected: string
  onSelect: (industry: string) => void
}

interface IndustryItem {
  value: string
  label: string
  icon: LucideIcon
}

const TOP_INDUSTRIES: IndustryItem[] = [
  // Accountants surfaced first — Nexley's primary vertical going forward.
  { value: 'accountant', label: 'Accountant', icon: Scale },
  { value: 'solicitor', label: 'Solicitor', icon: Scale },
  { value: 'plumber', label: 'Plumber', icon: Wrench },
  { value: 'electrician', label: 'Electrician', icon: Zap },
  { value: 'builder', label: 'Builder', icon: Hammer },
  { value: 'landscaper', label: 'Landscaper', icon: Trees },
  { value: 'roofer', label: 'Roofer', icon: Home },
  { value: 'cleaner', label: 'Cleaner', icon: Sparkles },
]

const MORE_INDUSTRIES: IndustryItem[] = [
  { value: 'hair-salon', label: 'Hair Salon', icon: Scissors },
  { value: 'gardener', label: 'Gardener', icon: Flower2 },
  { value: 'fencing', label: 'Fencing', icon: Fence },
  { value: 'paving', label: 'Paving', icon: LayoutGrid },
  { value: 'decking', label: 'Decking', icon: Sofa },
  { value: 'tree-surgeon', label: 'Tree Surgeon', icon: TreePine },
  { value: 'dental', label: 'Dental', icon: Heart },
  { value: 'estate-agent', label: 'Estate Agent', icon: Building2 },
  { value: 'recruitment', label: 'Recruitment', icon: Users },
  { value: 'dog-groomer', label: 'Dog Groomer', icon: Dog },
]

export default function IndustryPicker({ selected, onSelect }: IndustryPickerProps) {
  const [showMore, setShowMore] = useState(false)

  return (
    <LayoutGroup>
      <motion.div layout className="grid grid-cols-2 gap-3">
        {TOP_INDUSTRIES.map((industry) => (
          <IndustryCard
            key={industry.value}
            industry={industry}
            isSelected={selected === industry.value}
            onSelect={onSelect}
          />
        ))}

        <AnimatePresence>
          {showMore &&
            MORE_INDUSTRIES.map((industry, i) => (
              <motion.div
                key={industry.value}
                className="w-full"
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 20 }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 25,
                  delay: i * 0.04,
                }}
              >
                <IndustryCard
                  industry={industry}
                  isSelected={selected === industry.value}
                  onSelect={onSelect}
                />
              </motion.div>
            ))}
        </AnimatePresence>

        {/* More trades button — spans full width */}
        <motion.button
          layout
          onClick={() => setShowMore(!showMore)}
          className="col-span-2 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60 backdrop-blur transition-colors hover:border-white/20 hover:text-white/80"
        >
          {showMore ? (
            <>
              Show less <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              More trades... <ChevronDown className="h-4 w-4" />
            </>
          )}
        </motion.button>
      </motion.div>
    </LayoutGroup>
  )
}

function IndustryCard({
  industry,
  isSelected,
  onSelect,
}: {
  industry: IndustryItem
  isSelected: boolean
  onSelect: (value: string) => void
}) {
  const Icon = industry.icon

  return (
    <motion.button
      layout
      onClick={() => onSelect(industry.value)}
      whileTap={{ scale: 0.97 }}
      className={`
        relative flex w-full min-h-[72px] items-center gap-3 rounded-xl border px-4 py-3
        backdrop-blur transition-all duration-200
        ${
          isSelected
            ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]'
            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
        }
      `}
    >
      {/* Checkmark overlay */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 shadow-lg"
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        animate={isSelected ? { scale: 1.1 } : { scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        <Icon
          className={`h-6 w-6 flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-white/40'}`}
        />
      </motion.div>

      <span
        className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-white/70'}`}
      >
        {industry.label}
      </span>
    </motion.button>
  )
}
