import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Section } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { CreditCard, Receipt, XCircle, Sparkles, AlertTriangle } from 'lucide-react'

export const metadata: Metadata = { title: 'Billing | Nexley AI' }

type ClientRow = {
  id: string
  name: string
  email: string | null
  subscription_status: string
  subscription_plan: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  trial_ends_at: string | null
  created_at: string
}

type SubInfo = {
  nextBilling: string | null
  nextAmountPence: number | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  status: string | null
}

async function fetchStripeSubscription(subscriptionId: string): Promise<SubInfo | null> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !subscriptionId) return null
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub: any = await res.json()
    const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
    const price = sub.items?.data?.[0]?.price
    const amountPence = price?.unit_amount ?? null
    // If trialing, "next billing" is the trial end (Stripe bills then).
    // If active, "next billing" is current_period_end.
    const nextBilling = sub.status === 'trialing'
      ? (sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null)
      : currentPeriodEnd
    return {
      nextBilling,
      nextAmountPence: amountPence,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd,
      status: sub.status ?? null,
    }
  } catch {
    return null
  }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ portal_return?: string; error?: string }> }) {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/settings/billing')

  const supabase = await createClient()
  const clientId = session.clientId

  let client: ClientRow | null = null
  if (clientId) {
    const { data } = await supabase
      .from('clients')
      .select('id, name, email, subscription_status, subscription_plan, stripe_customer_id, stripe_subscription_id, trial_ends_at, created_at')
      .eq('id', clientId)
      .single()
    client = data as ClientRow | null
  }

  const subInfo = client?.stripe_subscription_id
    ? await fetchStripeSubscription(client.stripe_subscription_id)
    : null

  const sp = await searchParams
  const returnedFromPortal = sp.portal_return === '1'
  const error = sp.error

  const niceDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—'

  const nextBillAmount = subInfo?.nextAmountPence
    ? `£${(subInfo.nextAmountPence / 100).toFixed(2).replace(/\.00$/, '')}`
    : '£599'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm mt-1 text-muted-foreground">Manage your subscription, payment method, and invoices</p>
      </div>

      {returnedFromPortal && !error && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-success/5 border-brand-success/20">
          <p className="text-sm text-brand-success">Welcome back. Any changes you made in the billing portal are now live.</p>
        </div>
      )}

      {error === 'no_subscription' && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>No subscription found.</strong> Your account hasn&apos;t completed payment yet. If you just signed up, give it a minute — if this persists, contact support.
          </p>
        </div>
      )}

      {error === 'portal_failed' && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Couldn&apos;t open the billing portal.</strong> Try again in a moment. If this keeps happening, email hello@nexley.ai.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Current plan summary */}
        <Section title="Current plan" description="What you&apos;re paying for">
          <div className="divide-y divide-border -mx-5 sm:-mx-6">
            <SettingRow
              label="Plan"
              value={
                <span className="inline-flex items-center gap-2">
                  <Sparkles size={14} className="text-brand-primary" />
                  <span className="font-medium">AI Employee — £599 / month</span>
                </span>
              }
            />
            <SettingRow label="Status" value={<StatusBadge status={client?.subscription_status ?? 'trial'} />} />
            {client?.subscription_status === 'trial' && client?.trial_ends_at && (
              <SettingRow
                label="Trial ends"
                value={
                  <span>
                    {niceDate(client.trial_ends_at)}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      First £599 billing on this date unless you cancel
                    </span>
                  </span>
                }
              />
            )}
            {subInfo?.cancelAtPeriodEnd && (
              <SettingRow
                label="Scheduled cancellation"
                value={
                  <span className="text-red-400">
                    Cancels on {niceDate(subInfo.currentPeriodEnd)}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Your agent stays live until then. Resubscribe in the billing portal anytime.
                    </span>
                  </span>
                }
              />
            )}
            {client?.subscription_status === 'active' && !subInfo?.cancelAtPeriodEnd && (
              <SettingRow
                label="Next billing"
                value={
                  <span>
                    {nextBillAmount} on {niceDate(subInfo?.nextBilling)}
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Auto-charged to your card on file
                    </span>
                  </span>
                }
              />
            )}
            <SettingRow label="Billed to" value={client?.email ?? '—'} />
          </div>
        </Section>

        {/* Manage actions — open Stripe Portal */}
        <Section title="Manage subscription" description="Update your card, download invoices, or cancel">
          <div className="grid gap-3 sm:grid-cols-2">
            <PortalCard
              href="/api/stripe/portal"
              icon={<Receipt size={18} />}
              title="Open billing portal"
              subtitle="Invoices, payment history, receipts"
              primary
            />
            <PortalCard
              href="/api/stripe/portal?flow=payment"
              icon={<CreditCard size={18} />}
              title="Update payment method"
              subtitle="Change the card we bill"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            You&apos;ll be redirected to Stripe (our payment processor). Nexley never sees or stores your card details.
          </p>
        </Section>

        {/* Cancellation */}
        {client?.subscription_status !== 'cancelled' && !subInfo?.cancelAtPeriodEnd && (
          <Section title="Cancel subscription" description="Stop future £599 billing — your agent stays live until the end of the current period" className="border-red-500/20">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/5 border border-red-500/20 mb-4">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <strong className="text-red-400 block mb-1">Before you cancel:</strong>
                Your agent will keep answering calls and WhatsApp messages until the end of your current billing period. Your data (call logs, contacts, pipeline) is retained for 30 days in case you change your mind — after that it&apos;s permanently deleted under UK GDPR.
              </div>
            </div>
            <a
              href="/api/stripe/portal?flow=cancel"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <XCircle size={16} />
              Cancel subscription
            </a>
          </Section>
        )}

        {/* Reactivation — if cancelled */}
        {client?.subscription_status === 'cancelled' && (
          <Section title="Reactivate" description="Bring your AI Employee back online">
            <p className="text-sm text-muted-foreground mb-4">
              Your subscription is cancelled. If you want to restart, you can set up a new subscription below — your previous configuration will be restored.
            </p>
            <a
              href="/api/stripe/upgrade"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-brand-primary text-white hover:opacity-90 transition-opacity"
            >
              <Sparkles size={16} />
              Reactivate subscription
            </a>
          </Section>
        )}

        <Section title="Need help?" description="Questions about your subscription, invoices, or refunds">
          <a
            href="mailto:hello@nexley.ai"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline"
          >
            Email hello@nexley.ai →
          </a>
        </Section>
      </div>
    </div>
  )
}

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-4 gap-4">
      <span className="text-sm font-medium w-48 flex-shrink-0 text-muted-foreground">{label}</span>
      <span className="text-sm flex-1 text-right text-foreground">{value}</span>
    </div>
  )
}

function PortalCard({
  href, icon, title, subtitle, primary = false,
}: {
  href: string; icon: React.ReactNode; title: string; subtitle: string; primary?: boolean
}) {
  return (
    <a
      href={href}
      className={
        primary
          ? 'flex items-center gap-3 p-4 rounded-xl bg-brand-primary text-white hover:opacity-90 transition-opacity'
          : 'flex items-center gap-3 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors border border-border'
      }
    >
      <span className={primary ? 'text-white' : 'text-brand-primary'}>{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className={`block text-xs mt-0.5 ${primary ? 'text-white/80' : 'text-muted-foreground'}`}>{subtitle}</span>
      </span>
      <span className={primary ? 'text-white/80' : 'text-brand-primary'}>→</span>
    </a>
  )
}
