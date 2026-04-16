'use client'

import { motion } from 'motion/react'
import AnimatedNumber from '@/components/shared/AnimatedNumber'
import { TrendingUp } from 'lucide-react'

interface HeroRoiCardProps {
  savedPounds: number
}

export default function HeroRoiCard({ savedPounds }: HeroRoiCardProps) {
  if (savedPounds === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-2xl p-5 sm:p-6 mb-6 relative overflow-hidden"
      style={{ background: 'var(--hero-gradient)' }}
    >
      {/* Decorative circles */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5" />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white/5" />

      <div className="relative z-10 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-green-200" />
            <p className="text-green-200 text-xs sm:text-sm font-medium">Money saved this week</p>
          </div>
          <div className="text-white font-bold text-3xl sm:text-4xl lg:text-5xl tracking-tight">
            <AnimatedNumber target={savedPounds} prefix="£" duration={1200} />
          </div>
          <p className="text-green-200/80 text-xs mt-1.5">vs hiring an admin assistant (messages £5 · calls £15 · bookings £50)</p>
        </div>
        <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10">
          <span className="text-2xl">💰</span>
        </div>
      </div>
    </motion.div>
  )
}
