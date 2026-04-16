import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EstimateDetail from '@/components/estimates/EstimateDetail'

export const metadata: Metadata = { title: 'Estimate | Nexley AI' }

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/estimates')

  if (!session.clientId) notFound()

  const supabase = await createClient()
  const { data } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', id)
    .eq('client_id', session.clientId)
    .maybeSingle()

  if (!data) notFound()

  return (
    <div className="max-w-5xl">
      <EstimateDetail initial={data} />
    </div>
  )
}
