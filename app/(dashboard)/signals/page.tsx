import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SignalsList } from '@/components/signals/SignalsList'

export const dynamic = 'force-dynamic'

export default async function SignalsPage() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  if (!clientId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No client linked to this account. Contact support.
      </div>
    )
  }

  const { data: signals, error } = await sb
    .from('integration_signals')
    .select('*')
    .eq('client_id', clientId)
    .in('status', ['new', 'owner_approved'])
    .order('detected_at_iso', { ascending: false })
    .limit(100)

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-500">Failed to load signals: {error.message}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Integration signals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Proactive actions your AI employee spotted across your connected integrations
          (Gmail, Xero, Calendar, Stripe). Approve the ones you want it to action.
        </p>
      </div>

      <SignalsList initialSignals={signals ?? []} />
    </div>
  )
}
