import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import VariationsList from '@/components/variations/VariationsList'

export const metadata: Metadata = { title: 'Variations | Nexley AI' }

export default async function VariationsPage() {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/variations')

  const supabase = await createClient()

  const { data } = session.clientId
    ? await supabase
        .from('variations')
        .select('*')
        .eq('client_id', session.clientId)
        .order('logged_at', { ascending: false })
        .limit(50)
    : { data: [] }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Variations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scope changes your AI Employee captured on live jobs. Review, send to client, mark approved.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-64 rounded-xl" />}>
        <VariationsList initial={data ?? []} />
      </Suspense>
    </div>
  )
}
