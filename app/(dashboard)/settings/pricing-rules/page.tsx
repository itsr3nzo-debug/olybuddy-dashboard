import type { Metadata } from 'next'
import { Suspense } from 'react'
import PricingRulesEditor from '@/components/settings/PricingRulesEditor'

export const metadata: Metadata = { title: 'Pricing rules | Nexley AI' }

export default function PricingRulesPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pricing rules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your rate card. Your AI Employee uses this every time it drafts a quote or variation.
          Get this right once and stop re-doing the maths on every job.
        </p>
      </div>
      <Suspense fallback={<div className="skeleton h-80 rounded-xl" />}>
        <PricingRulesEditor />
      </Suspense>
    </div>
  )
}
