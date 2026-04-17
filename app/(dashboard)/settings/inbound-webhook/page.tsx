import type { Metadata } from 'next'
import { Suspense } from 'react'
import InboundWebhookControls from '@/components/settings/InboundWebhookControls'

export const metadata: Metadata = { title: 'Inbound webhook | Nexley AI' }

export default function InboundWebhookPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Inbound webhook</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Let any external tool — website form, Typeform, Calendly, Fathom — trigger your AI Employee. The agent processes incoming triggers every 5 minutes and handles them based on your trust level.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-80 rounded-xl" />}>
        <InboundWebhookControls />
      </Suspense>
    </div>
  )
}
