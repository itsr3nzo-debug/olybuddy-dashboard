import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Money | Nexley AI' }
import { redirect } from 'next/navigation'
import { COST_PER_CALL_PENCE, COST_PER_FOLLOWUP_PENCE, PLAN_PRICES_PENCE } from '@/lib/constants'
import { formatCurrency } from '@/lib/format'
import KpiCard from '@/components/dashboard/KpiCard'
import HeroSaved from '@/components/money/HeroSaved'
import { Phone, MessageSquare, TrendingUp } from 'lucide-react'

export default async function MoneyPage() {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/money')

  const supabase = await createClient()
  const clientId = session.clientId

  let totalAnswered = 0
  let totalFollowUps = 0
  let totalBookingsValue = 0
  let memberSince = ''
  let monthlySpend = 59900

  if (clientId) {
    const { count } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'completed')
    totalAnswered = count ?? 0

    const { count: fc } = await supabase
      .from('comms_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('direction', 'outbound')
    totalFollowUps = fc ?? 0

    const { data: wonOpps } = await supabase
      .from('opportunities')
      .select('value_pence')
      .eq('client_id', clientId)
      .in('stage', ['won', 'closed_won'])
    totalBookingsValue = (wonOpps ?? []).reduce((sum, o: { value_pence: number | null }) => sum + (o.value_pence ?? 0), 0)

    const { data: client } = await supabase
      .from('clients')
      .select('subscription_plan, created_at')
      .eq('id', clientId)
      .single()
    if (client) {
      memberSince = client.created_at
      monthlySpend = PLAN_PRICES_PENCE[client.subscription_plan] ?? 59900
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Money</h1>
        <p className="text-sm mt-1 text-muted-foreground">Your AI Employee&apos;s financial impact · all time</p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Setup required:</strong> Account not linked. Contact Nexley AI.
          </p>
        </div>
      )}

      {/* Hero animated savings */}
      <HeroSaved savedPence={totalSaved} roi={roi} memberSince={memberSince} />

      {/* KPI breakdown cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Conversations Handled"
          value={totalAnswered}
          sub={`× £15/call = ${formatCurrency(callsSaved)}`}
          color="success"
          animate
          icon={<MessageSquare size={16} />}
        />
        <KpiCard
          label="Follow-ups Sent"
          value={totalFollowUps}
          sub={`× £2/follow-up = ${formatCurrency(followUpsSaved)}`}
          color="accent"
          animate
          icon={<MessageSquare size={16} />}
        />
        <KpiCard
          label="Revenue Attributed"
          value={formatCurrency(totalBookingsValue)}
          sub="from won opportunities"
          color="success"
          icon={<TrendingUp size={16} />}
        />
      </div>

      {/* Savings breakdown */}
      <div className="rounded-xl border p-6 mb-6 bg-card">
        <h2 className="text-sm font-semibold mb-2 text-foreground">How we calculate this</h2>
        <p className="text-xs mb-5 text-muted-foreground">Based on UK average admin costs (£5/message, £15/call, £50/booking, £2/follow-up)</p>
        <div className="space-y-0 divide-y divide-border">
          <SavingsRow label="Calls answered" count={totalAnswered} unit="£15/call" value={callsSaved} />
          <SavingsRow label="Follow-ups automated" count={totalFollowUps} unit="£2/follow-up" value={followUpsSaved} />
          {totalBookingsValue > 0 && (
            <SavingsRow label="Revenue from bookings" count={0} unit="won opportunities" value={totalBookingsValue} />
          )}
        </div>
      </div>

      {/* ROI summary */}
      {roi > 0 && (
        <div className="rounded-xl border p-6 mb-6 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Return on Investment</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatCurrency(totalSaved)} saved ÷ {formatCurrency(totalSpent)} spent over {monthsActive} month{monthsActive > 1 ? 's' : ''}
              </p>
            </div>
            <div className="text-3xl font-bold text-brand-success">
              {roi}x
            </div>
          </div>
        </div>
      )}

      {/* Referral CTA */}
      <div className="rounded-xl border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-card">
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Share your results</p>
          <p className="text-xs mt-1 text-muted-foreground">
            Know another tradesperson who could use an AI Employee? Refer them and get a free month.
          </p>
        </div>
        <a
          href="https://nexley.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 flex-shrink-0 bg-brand-success text-white"
        >
          Refer a friend →
        </a>
      </div>
    </div>
  )
}

function SavingsRow({ label, count, unit, value }: { label: string; count: number; unit: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-4">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {count > 0 && <p className="text-xs mt-0.5 text-muted-foreground">{count} × {unit}</p>}
      </div>
      <span className="text-lg font-bold text-brand-success">{formatCurrency(value)}</span>
    </div>
  )
}
