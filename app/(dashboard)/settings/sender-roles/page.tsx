import type { Metadata } from 'next'
import { Suspense } from 'react'
import SenderRolesEditor from '@/components/settings/SenderRolesEditor'

export const metadata: Metadata = { title: 'Sender Roles | Nexley AI' }

export default function SenderRolesPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sender Roles</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tell your AI Employee who&apos;s the boss and who&apos;s a customer.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-80 w-full rounded-xl" />}>
        <SenderRolesEditor />
      </Suspense>
    </div>
  )
}
