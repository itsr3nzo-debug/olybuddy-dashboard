import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/format'
import EmptyState from '@/components/shared/EmptyState'
import { Calendar as CalendarIcon, Clock, ExternalLink } from 'lucide-react'

export const metadata: Metadata = { title: 'Calendar | Olybuddy' }

export default async function CalendarPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let upcoming: Array<Record<string, unknown>> = []

  if (clientId) {
    const { data } = await supabase
      .from('opportunities')
      .select('id, title, stage, value_pence, expected_close, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .not('expected_close', 'is', null)
      .gte('expected_close', new Date().toISOString().split('T')[0])
      .order('expected_close', { ascending: true })
      .limit(20)

    upcoming = (data ?? []) as Array<Record<string, unknown>>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <p className="text-sm mt-1 text-muted-foreground">Upcoming appointments and bookings</p>
      </div>

      {/* Upcoming appointments */}
      <div className="rounded-xl border p-5 bg-card mb-6" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold text-foreground mb-4">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={24} />}
            title="No upcoming appointments"
            description="Appointments will appear here when opportunities have expected close dates set."
          />
        ) : (
          <div className="space-y-3">
            {upcoming.map(o => {
              const contact = o.contacts as { first_name?: string; last_name?: string; phone?: string } | null
              const name = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') : 'Unknown'
              const date = new Date(o.expected_close as string)
              const isThisWeek = date.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000

              return (
                <div key={o.id as string} className={`flex items-center justify-between p-3 rounded-lg border ${isThisWeek ? 'border-brand-primary/30 bg-brand-primary/5' : 'border-border'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${isThisWeek ? 'bg-brand-primary/10 text-brand-primary' : 'bg-muted text-muted-foreground'}`}>
                      <CalendarIcon size={16} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{o.title as string}</p>
                      <p className="text-xs text-muted-foreground">{name} · {o.stage as string}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                    {(o.value_pence as number) > 0 && (
                      <p className="text-xs text-brand-success">{formatCurrency(o.value_pence as number)}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cal.com booking embed placeholder */}
      <div className="rounded-xl border p-6 bg-card" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-brand-primary" />
          <h2 className="text-sm font-semibold text-foreground">Book a Consultation</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Let your customers book appointments directly. Cal.com scheduling integration coming soon.
        </p>
        <a
          href="https://cal.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors"
        >
          Set up Cal.com <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}
