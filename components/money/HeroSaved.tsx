'use client'

import AnimatedNumber from '@/components/shared/AnimatedNumber'

interface HeroSavedProps {
  savedPence: number
  roi: number
  memberSince: string
}

export default function HeroSaved({ savedPence, roi, memberSince }: HeroSavedProps) {
  const pounds = Math.round(savedPence / 100)

  return (
    <div className="rounded-2xl p-6 sm:p-8 mb-6 text-center" style={{ background: 'var(--hero-gradient)' }}>
      <p className="text-green-200 text-sm font-medium mb-2">Your AI Employee has saved you</p>
      <div className="text-white font-bold" style={{ fontSize: 'clamp(2rem, 8vw, 3.5rem)', lineHeight: 1 }}>
        <AnimatedNumber target={pounds} prefix="£" duration={1200} />
      </div>
      {memberSince && (
        <p className="text-green-200 text-sm mt-3">since you started with Nexley AI</p>
      )}
      {roi > 1 && (
        <div className="inline-block mt-4 bg-white/20 rounded-full px-4 py-1.5">
          <span className="text-white text-sm font-semibold">£{roi} returned for every £1 spent</span>
        </div>
      )}
    </div>
  )
}
