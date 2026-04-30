import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EmptyState from '@/components/shared/EmptyState'
import MonthGrid from '@/components/calendar/MonthGrid'
import { Calendar as CalendarIcon, Clock, ExternalLink } from 'lucide-react'

export const metadata: Metadata = { title: 'Calendar | Nexley AI' }

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  const params = await searchParams
  const month = params.month

  let opportunities: Array<{
    id: string
    title: string
    stage: string
    value_pence: number
    expected_close: string
    contacts: { first_name: string | null; last_name: string | null } | null
  }> = []

  if (clientId) {
    const { data } = await supabase
      .from('opportunities')
      .select('id, title, stage, value_pence, expected_close, contacts(first_name, last_name)')
      .eq('client_id', clientId)
      .not('expected_close', 'is', null)
      .order('expected_close', { ascending: true })

    opportunities = ((data ?? []) as unknown) as typeof opportunities
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Calendar</h1>
        <p className="text-sm mt-1 text-muted-foreground">
          {opportunities.length} deal{opportunities.length === 1 ? '' : 's'} with expected close dates
        </p>
      </div>

      {clientId && opportunities.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={24} />}
          title="No deals with dates"
          description="When opportunities in your pipeline have expected close dates, they'll appear here on the calendar."
        />
      ) : (
        <Suspense fallback={<div className="skeleton w-full h-[500px] rounded-xl" />}>
          <MonthGrid opportunities={opportunities} initialMonth={month} />
        </Suspense>
      )}

      {/* Booking link — Cal.com is a standalone external tool your AI Employee
          can point customers at. Keeping this card as a surface to the external
          workflow is honest about the scope (no "coming soon" promise of a
          native embed we aren't actively building). When a proper Cal.com
          integration exists it'll show up on /integrations and this card can
          go away. */}
      <div className="rounded-xl border p-6 bg-card mt-6 border-border">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-brand-primary" />
          <h2 className="text-sm font-semibold text-foreground">Use Cal.com alongside Nexley</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Your AI Employee can share a Cal.com booking link with customers so they pick their own slot.
          Set up a free Cal.com account, then paste your booking URL under Sender Roles &rarr; booking link.
        </p>
        <a
          href="https://cal.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors"
        >
          Open Cal.com <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}
