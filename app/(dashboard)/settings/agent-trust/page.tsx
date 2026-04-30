import type { Metadata } from 'next'
import { Suspense } from 'react'
import AgentTrustControls from '@/components/settings/AgentTrustControls'

export const metadata: Metadata = { title: 'Agent trust level | Nexley AI' }

export default function AgentTrustPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Agent trust level</h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          How much freedom your AI Employee has to reply to customers without your sign-off.
          Higher trust = faster for customers, more risk if the agent misjudges. Start at level 2 for a week or two,
          then raise to 3 when you&apos;re confident.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-96 rounded-lg" />}>
        <AgentTrustControls />
      </Suspense>
    </div>
  )
}
