import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const COST_PER_CALL_PENCE = 1500    // £15/call (receptionist equivalent)
const COST_PER_FOLLOWUP_PENCE = 200 // £2/follow-up (admin time saved)

function poundsStr(pence: number) {
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function SavingsRow({ label, count, unit, value }: { label: string; count: number; unit: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-4 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{count} × {unit}</p>
      </div>
      <span className="text-lg font-bold" style={{ color: 'var(--success)' }}>{poundsStr(value)}</span>
    </div>
  )
}

export default async function MoneyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let totalAnswered = 0
  let totalFollowUps = 0
  let totalBookingsValue = 0
  let memberSince = ''
  let monthlySpend = 19900 // default £199/mo in pence

  if (clientId) {
    // All-time answered calls
    const { count } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'completed')
    totalAnswered = count ?? 0

    // Outbound follow-ups (comms_log)
    const { count: fc } = await supabase
      .from('comms_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('direction', 'outbound')
    totalFollowUps = fc ?? 0

    // Won opportunities total value
    const { data: wonOpps } = await supabase
      .from('opportunities')
      .select('value_pence')
      .eq('client_id', clientId)
      .eq('stage', 'closed_won')
    totalBookingsValue = (wonOpps ?? []).reduce((sum: number, o: { value_pence: number | null }) => sum + (o.value_pence ?? 0), 0)

    // Client plan → monthly spend
    const { data: client } = await supabase
      .from('clients')
      .select('subscription_plan, created_at')
      .eq('id', clientId)
      .single()
    if (client) {
      memberSince = client.created_at
      if (client.subscription_plan === 't1') monthlySpend = 9900
      else if (client.subscription_plan === 't3') monthlySpend = 39900
    }
  }

  const callsSaved = totalAnswered * COST_PER_CALL_PENCE
  const followUpsSaved = totalFollowUps * COST_PER_FOLLOWUP_PENCE
  const totalSaved = callsSaved + followUpsSaved + totalBookingsValue
  const monthsActive = memberSince
    ? Math.max(1, Math.ceil((Date.now() - new Date(memberSince).getTime()) / (1000 * 60 * 60 * 24 * 30)))
    : 1
  const totalSpent = monthlySpend * monthsActive
  const roi = totalSpent > 0 ? Math.round((totalSaved / totalSpent) * 10) / 10 : 0

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Money</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Your AI Employee&apos;s financial impact · all time</p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>Setup required:</strong> Account not linked. Contact Olybuddy.
          </p>
        </div>
      )}

      {/* Hero card */}
      <div className="rounded-2xl p-8 mb-6 text-center" style={{ background: 'linear-gradient(135deg, #166534 0%, #15803d 50%, #16a34a 100%)' }}>
        <p className="text-green-200 text-sm font-medium mb-2">Your AI Employee has saved you</p>
        <p className="text-white font-bold" style={{ fontSize: '3.5rem', lineHeight: 1 }}>
          {poundsStr(totalSaved)}
        </p>
        <p className="text-green-200 text-sm mt-3">since you started with Olybuddy</p>
        {roi > 1 && (
          <div className="inline-block mt-4 bg-white/20 rounded-full px-4 py-1.5">
            <span className="text-white text-sm font-semibold">£{roi} returned for every £1 spent</span>
          </div>
        )}
      </div>

      {/* Savings breakdown */}
      <div className="rounded-xl border p-6 mb-6" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>How we calculate this</h2>
        <p className="text-xs mb-5" style={{ color: 'var(--muted)' }}>Based on UK average receptionist costs (£15/call) and admin time (£2/follow-up)</p>
        <SavingsRow label="Calls answered" count={totalAnswered} unit="£15/call" value={callsSaved} />
        <SavingsRow label="Follow-ups automated" count={totalFollowUps} unit="£2/follow-up" value={followUpsSaved} />
        {totalBookingsValue > 0 && (
          <SavingsRow label="Revenue from bookings" count={0} unit="won opportunities" value={totalBookingsValue} />
        )}
      </div>

      {/* Referral CTA */}
      <div className="rounded-xl border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Share your results</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Know another tradesperson who could use an AI Employee? Refer them and get a free month.
          </p>
        </div>
        <a
          href="https://olybuddy.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 flex-shrink-0"
          style={{ background: 'var(--success)', color: '#fff' }}
        >
          Refer a friend →
        </a>
      </div>
    </div>
  )
}
