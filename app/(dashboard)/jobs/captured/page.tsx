import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import CapturedJobsList from '@/components/jobs/CapturedJobsList'

export const metadata: Metadata = { title: 'Captured jobs | Nexley AI' }

export default async function CapturedJobsPage() {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/jobs/captured')

  const supabase = await createClient()

  const { data: jobs } = session.clientId
    ? await supabase
        .from('captured_jobs')
        .select('*')
        .eq('client_id', session.clientId)
        .order('captured_at', { ascending: false })
        .limit(50)
    : { data: [] }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Captured jobs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Voice notes, photos, and forwards your AI Employee turned into structured jobs. Review and push to your job system.
        </p>
      </div>

      <Suspense fallback={<div className="skeleton h-64 rounded-xl" />}>
        <CapturedJobsList initial={jobs ?? []} />
      </Suspense>
    </div>
  )
}
