import type { Metadata } from 'next'
import { Suspense } from 'react'
import EmergencyControls from '@/components/settings/EmergencyControls'

export const metadata: Metadata = { title: 'Emergency controls | Nexley AI' }

export default function EmergencyPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Emergency controls</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pause your AI Employee immediately. Pre-send check on every outbound message — takes effect within seconds.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-60 rounded-xl" />}>
        <EmergencyControls />
      </Suspense>
    </div>
  )
}
