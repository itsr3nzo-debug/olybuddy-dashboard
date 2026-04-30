'use client'

import { useState } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'motion/react'
import {
  Wrench,
  Zap,
  Hammer,
  Trees,
  Home,
  Brush,
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
  { value: 'cleaner', label: 'Cleaner', icon: Brush },
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
      <motion.div layout className="grid grid-cols-2 gap-2 sm:gap-3">
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
          type="button"
          onClick={() => setShowMore(!showMore)}
          className="col-span-2 flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 h-10 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showMore ? (
            <>
              Show less <ChevronUp size={14} strokeWidth={1.5} />
            </>
          ) : (
            <>
              More industries <ChevronDown size={14} strokeWidth={1.5} />
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
      type="button"
      onClick={() => onSelect(industry.value)}
      aria-pressed={isSelected}
      className={`
        relative flex w-full min-h-[56px] items-center gap-3 rounded-md border px-3 py-2.5
        transition-colors text-left
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        ${
          isSelected
            ? 'border-primary bg-primary/8 shadow-[inset_2px_0_0_0_var(--primary)]'
            : 'border-border bg-card hover:bg-muted/40'
        }
      `}
    >
      <Icon
        size={18}
        strokeWidth={1.5}
        className={`shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground/60'}`}
      />
      <span
        className={`text-sm font-medium tracking-tight ${
          isSelected ? 'text-foreground' : 'text-foreground/85'
        }`}
      >
        {industry.label}
      </span>
      {isSelected && (
        <Check
          size={14}
          strokeWidth={2}
          className="ml-auto text-primary shrink-0"
          aria-hidden
        />
      )}
    </motion.button>
  )
}
