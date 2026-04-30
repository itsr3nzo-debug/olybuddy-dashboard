import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import KanbanBoard from '@/components/pipeline/KanbanBoard'
import EmptyState from '@/components/shared/EmptyState'
import { Kanban } from 'lucide-react'

// "Pipeline" / "deals" / "opportunities" is CRM jargon. The customer
// (a plumber, electrician, accountant) calls them "jobs". The DA pass
// flagged this — renaming the page heading to plumber-language costs
// nothing and removes a barrier. URL stays `/pipeline` for backwards
// compatibility with bookmarks; only the visible label changes.
export const metadata: Metadata = { title: 'Jobs | Nexley AI' }

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let opportunities: Array<Record<string, unknown>> = []

  if (clientId) {
    const { data } = await supabase
      .from('opportunities')
      .select('*, contacts(first_name, last_name, company, phone)')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })

    opportunities = (data ?? []) as Array<Record<string, unknown>>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Jobs</h1>
        <p className="text-sm mt-1 text-muted-foreground">
          Drag jobs between stages to update where they are
        </p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Setup required:</strong> Account not linked. Contact Nexley AI.
          </p>
        </div>
      )}

      {opportunities.length > 0 ? (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <KanbanBoard opportunities={opportunities as any} />
      ) : clientId ? (
        <EmptyState
          icon={<Kanban size={24} />}
          title="No deals yet"
          description="Opportunities will appear here when your AI Employee starts booking demos and qualifying leads."
        />
      ) : null}
    </div>
  )
}
