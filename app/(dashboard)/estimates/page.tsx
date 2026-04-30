import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import EstimatesList from '@/components/estimates/EstimatesList'

export const metadata: Metadata = { title: 'Estimates | Nexley AI' }

export default async function EstimatesPage() {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/estimates')

  const supabase = await createClient()

  const { data } = session.clientId
    ? await supabase
        .from('estimates')
        .select('id, title, created_at, estimated_total_gbp, actual_total_gbp, margin_delta_pct, status, takeoff_confidence, source_pages')
        .eq('client_id', session.clientId)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Estimates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a plan PDF. Your AI Employee drafts the take-off and pricing. You review and send.
          </p>
        </div>
      </div>

      <Suspense fallback={<div className="skeleton h-64 rounded-xl" />}>
        <EstimatesList initial={data ?? []} />
      </Suspense>
    </div>
  )
}
