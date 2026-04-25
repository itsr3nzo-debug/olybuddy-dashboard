import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Section } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { CreditCard, Receipt, XCircle, Sparkles, AlertTriangle, RefreshCw, CheckCircle } from 'lucide-react'
import ReferralCard from '@/components/dashboard/ReferralCard'

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
  status: string | null
  nextBilling: string | null
  nextAmountPence: number | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  trialEnd: string | null
}

/**
 * Fetches live subscription state from Stripe. Handles the 2025 API change
 * where current_period_start/end moved from subscription level to item level.
 */
async function fetchStripeSubscription(subscriptionId: string): Promise<SubInfo | null> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !subscriptionId) return null
  try {
    // Hard timeout so a slow/down Stripe API can't hang a server-render.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price`,
      { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: controller.signal }
    ).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub: any = await res.json()
    const firstItem = sub.items?.data?.[0]
    const cpeRaw = firstItem?.current_period_end ?? sub.current_period_end ?? null
    const currentPeriodEnd = cpeRaw ? new Date(cpeRaw * 1000).toISOString() : null
    const amountPence = firstItem?.price?.unit_amount ?? null
    const trialEndIso = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
    // "Next billing" = the next date Stripe will attempt a charge.
    const nextBilling = sub.status === 'trialing'
      ? trialEndIso
      : currentPeriodEnd
    return {
      status: sub.status ?? null,
      nextBilling,
      nextAmountPence: amountPence,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      currentPeriodEnd,
      trialEnd: trialEndIso,
    }
  } catch {
    return null
  }
}

/**
 * Computes the UI state based on Supabase + live Stripe data.
 * Single source of truth for what we render.
 */
type UIState =
  | { kind: 'needs_setup' }                                       // No Stripe customer yet — legacy client or fresh signup before payment
  | { kind: 'pending_payment' }                                   // Checkout in flight — webhook will flip state within seconds
  | { kind: 'trialing'; info: SubInfo }                           // Paid £20, card saved, 5-day trial active
  | { kind: 'active'; info: SubInfo }                             // Paying £599/mo
  | { kind: 'scheduled_cancel'; info: SubInfo }                   // Cancelled but still has access until period end
  | { kind: 'past_due'; info: SubInfo }                           // Card failed — payment method needs update
  | { kind: 'cancelled'; info: SubInfo | null; legacy: boolean }  // Sub ended or no sub + status=cancelled

function deriveState(client: ClientRow, info: SubInfo | null): UIState {
  if (!client.stripe_customer_id || !client.stripe_subscription_id) {
    if (client.subscription_status === 'cancelled') {
      return { kind: 'cancelled', info: null, legacy: true }
    }
    // They went through Checkout but webhook hasn't attached the sub yet.
    // Short-lived state — show a reassuring page rather than the "set up
    // billing" CTA (which would launch ANOTHER checkout and risk double-pay).
    if (client.subscription_status === 'pending_payment') {
      return { kind: 'pending_payment' }
    }
    return { kind: 'needs_setup' }
  }
  if (!info) {
    // Have IDs but Stripe call failed — assume active, portal button still works
    return { kind: 'active', info: { status: 'active', nextBilling: null, nextAmountPence: 59999, cancelAtPeriodEnd: false, currentPeriodEnd: null, trialEnd: null } }
  }
  if (info.cancelAtPeriodEnd) return { kind: 'scheduled_cancel', info }
  if (info.status === 'past_due' || info.status === 'unpaid') return { kind: 'past_due', info }
  if (info.status === 'canceled') return { kind: 'cancelled', info, legacy: false }
  if (info.status === 'trialing') return { kind: 'trialing', info }
  return { kind: 'active', info }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ portal_return?: string; upgraded?: string; upgraded_early?: string; upgrade_cancelled?: string; error?: string; pending_payment?: string }> }) {
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

  const state = client ? deriveState(client, subInfo) : null
  const sp = await searchParams

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm mt-1 text-muted-foreground">
          Your subscription, payment method, and invoices — hosted securely by Stripe
        </p>
      </div>

      {/* Banners based on query-string state */}
      {sp.upgraded === '1' && (
        <Banner kind="success" title="Payment received">
          Your AI Employee is live. Your 5-day trial has started — you&apos;ll be auto-charged £599 on Day 6 unless you cancel.
        </Banner>
      )}
      {sp.upgraded_early === '1' && (
        <Banner kind="success" title="Upgraded to paid">
          Trial ended early — your first £599 month just started. Thanks for betting on us.
        </Banner>
      )}
      {sp.portal_return === '1' && !sp.error && (
        <Banner kind="success" title="Welcome back">
          Any changes you made in the billing portal are now live.
        </Banner>
      )}
      {sp.upgrade_cancelled === '1' && (
        <Banner kind="info" title="Checkout cancelled">
          No charge was made. You can retry whenever you&apos;re ready.
        </Banner>
      )}
      {sp.error === 'stripe_not_configured' && (
        <Banner kind="warning" title="Billing temporarily unavailable">
          We&apos;re upgrading the payment system. Try again in a few minutes or email hello@nexley.ai.
        </Banner>
      )}
      {sp.error === 'checkout_failed' && (
        <Banner kind="warning" title="Couldn&apos;t open checkout">
          Something went wrong creating your checkout session. Try again, or email hello@nexley.ai if it persists.
        </Banner>
      )}
      {sp.error === 'no_subscription' && (
        <Banner kind="info" title="No subscription on file">
          You haven&apos;t set up billing yet. Click &quot;Set up billing&quot; below to activate your paid plan.
        </Banner>
      )}
      {sp.error === 'rate_limited' && (
        <Banner kind="warning" title="Too many attempts">
          Slow down — you&apos;ve hit the billing-action limit. Try again in 10 minutes, or email hello@nexley.ai if something&apos;s stuck.
        </Banner>
      )}

      {!client && (
        <Banner kind="warning" title="No client record">
          Your user account isn&apos;t linked to a business. Contact Nexley AI to complete onboarding.
        </Banner>
      )}

      {client && state && (
        <div className="space-y-6">
          {/* STATE: pending_payment — Checkout in flight. Don't offer a second. */}
          {state.kind === 'pending_payment' && (
            <Section title="Finalising your payment" description="Stripe is confirming the charge">
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                This page will update automatically once Stripe confirms your payment (usually within 15 seconds of checkout completion). If nothing has happened after a minute, refresh the page — if it&apos;s still stuck, email hello@nexley.ai and we&apos;ll sort it.
              </p>
              <a
                href="/settings/billing"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/30 border border-border text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                Refresh
              </a>
            </Section>
          )}

          {/* STATE: needs_setup — legacy client or unpaid signup. Show the offer. */}
          {state.kind === 'needs_setup' && (
            <>
              <Section title="Set up billing" description="Activate your paid AI Employee subscription">
                <div className="px-1">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                    <Perk title="£20 onboarding fee" sub="Charged now — unlocks your 5-day trial on a dedicated VPS" />
                    <Perk title="5-day trial" sub="Full access to your AI Employee. Cancel any time with no further charge." />
                    <Perk title="£599 / month" sub="Auto-billed on Day 6 unless you cancel during the trial" />
                  </div>
                  <a
                    href="/api/stripe/upgrade"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/25"
                  >
                    <Sparkles size={16} />
                    Set up billing — £20
                  </a>
                  <p className="text-xs text-muted-foreground mt-3">
                    You&apos;ll be redirected to Stripe to enter your card. Nexley never sees or stores your card details.
                  </p>
                </div>
              </Section>
              <Section title="Why we charge £20 upfront" description="Reduces no-shows and proves you&apos;re serious">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The £20 onboarding covers the cost of provisioning your dedicated Hetzner server, WhatsApp number, and 5 days of Claude API usage. If you decide the AI Employee isn&apos;t for you within those 5 days, cancel from here in two clicks — no further charge. If you stay on, your first £599 month kicks in on Day 6 and the £20 is effectively absorbed into the subscription.
                </p>
              </Section>
            </>
          )}

          {/* STATE: trialing — paid £20, in the 5-day window */}
          {state.kind === 'trialing' && (
            <>
              <Section title="Current plan" description="Your trial is active">
                <div className="divide-y divide-border -mx-5 sm:-mx-6">
                  <Row label="Plan" value={<PlanValue label="AI Employee — £599 / month" />} />
                  <Row label="Status" value={<StatusBadge status="trial" />} />
                  <Row
                    label="Trial ends"
                    value={<span>{niceDate(state.info.trialEnd)}<Help>Your card will be auto-charged £599 on this date unless you cancel.</Help></span>}
                  />
                  <Row label="Billed to" value={client.email ?? '—'} />
                </div>
              </Section>

              {/* Upgrade-now — low-pressure secondary option. Most trial users
                  just wait for auto-bill; this is for the ones who want to
                  commit early. Ends the Stripe trial immediately + charges £599. */}
              <Section
                title="Skip the wait?"
                description="Upgrade to paid now and start your first £599 month today"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 text-sm text-muted-foreground">
                    No need to do anything — your card will be charged automatically when the trial ends. But if you already know you&apos;re staying, you can upgrade now and start month 1 straight away.
                  </div>
                  <a
                    href="/api/stripe/upgrade"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/25 whitespace-nowrap"
                  >
                    <Sparkles size={14} />
                    Upgrade now — £599/mo
                  </a>
                </div>
              </Section>

              <ManageCards showCancel />
              <DangerCancel />
            </>
          )}

          {/* STATE: active — paying £599/mo */}
          {state.kind === 'active' && (
            <>
              <Section title="Current plan" description="Your subscription is active">
                <div className="divide-y divide-border -mx-5 sm:-mx-6">
                  <Row label="Plan" value={<PlanValue label="AI Employee — £599 / month" />} />
                  <Row label="Status" value={<StatusBadge status="active" />} />
                  <Row
                    label="Next billing"
                    value={<span>{formatAmount(state.info.nextAmountPence)} on {niceDate(state.info.nextBilling)}<Help>Auto-charged to your card on file.</Help></span>}
                  />
                  <Row label="Billed to" value={client.email ?? '—'} />
                </div>
              </Section>
              <ManageCards showCancel />
              <DangerCancel />
            </>
          )}

          {/* STATE: scheduled_cancel — cancelled, access until period end */}
          {state.kind === 'scheduled_cancel' && (
            <>
              <Section title="Scheduled cancellation" description="Your AI Employee is still running until the end of the period">
                <div className="divide-y divide-border -mx-5 sm:-mx-6">
                  <Row label="Plan" value={<PlanValue label="AI Employee — £599 / month" />} />
                  <Row label="Status" value={<StatusBadge status="active" />} />
                  <Row
                    label="Cancels on"
                    value={<span className="text-red-400">{niceDate(state.info.currentPeriodEnd)}<Help>Your agent stays live until this date. Resume your subscription any time from the billing portal.</Help></span>}
                  />
                  <Row label="Billed to" value={client.email ?? '—'} />
                </div>
              </Section>
              <ManageCards showCancel={false} resumeLabel="Resume subscription" />
            </>
          )}

          {/* STATE: past_due — payment failed */}
          {state.kind === 'past_due' && (
            <>
              <Banner kind="warning" title="Payment failed">
                Your most recent £599 charge was declined. Update your card immediately to avoid losing access.
              </Banner>
              <Section title="Current plan" description="Payment needs attention">
                <div className="divide-y divide-border -mx-5 sm:-mx-6">
                  <Row label="Plan" value={<PlanValue label="AI Employee — £599 / month" />} />
                  <Row label="Status" value={<StatusBadge status="paused" />} />
                  <Row label="Billed to" value={client.email ?? '—'} />
                </div>
                <div className="pt-4">
                  <a
                    href="/api/stripe/portal?flow=payment"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <CreditCard size={16} />
                    Update payment method
                  </a>
                </div>
              </Section>
            </>
          )}

          {/* STATE: cancelled — former customer */}
          {state.kind === 'cancelled' && (
            <>
              <Section title="Subscription ended" description={state.legacy ? 'Your legacy trial has ended' : 'Your paid subscription was cancelled'}>
                <p className="text-sm text-muted-foreground mb-4">
                  {state.legacy
                    ? 'Ready to come back? Set up billing now — £20 to unlock a fresh 5-day trial, then £599/mo if you stay.'
                    : 'Your data is kept for 30 days after cancellation under UK GDPR. Reactivate now to pick up exactly where you left off.'}
                </p>
                <a
                  href="/api/stripe/upgrade"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  <RefreshCw size={16} />
                  Reactivate — £20
                </a>
              </Section>
            </>
          )}

          <ReferralCard />

          <Section title="Need help?" description="Questions about billing, refunds, or your plan">
            <a href="mailto:hello@nexley.ai" className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline">
              Email hello@nexley.ai →
            </a>
          </Section>
        </div>
      )}
    </div>
  )
}

// ─── UI primitives ──────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between py-3 sm:py-4 gap-1 sm:gap-4">
      <span className="text-xs sm:text-sm font-medium sm:w-48 sm:flex-shrink-0 text-muted-foreground">{label}</span>
      <span className="text-sm flex-1 sm:text-right text-foreground break-words">{value}</span>
    </div>
  )
}

function PlanValue({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Sparkles size={14} className="text-brand-primary" />
      <span className="font-medium">{label}</span>
    </span>
  )
}

function Help({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs text-muted-foreground mt-0.5">{children}</span>
}

function Banner({ kind, title, children }: { kind: 'success' | 'warning' | 'info'; title: string; children: React.ReactNode }) {
  const styles = {
    success: 'bg-brand-success/5 border-brand-success/20 text-brand-success',
    warning: 'bg-brand-warning/5 border-brand-warning/20 text-brand-warning',
    info: 'bg-brand-info/5 border-brand-info/20 text-brand-info',
  }
  const Icon = kind === 'success' ? CheckCircle : kind === 'warning' ? AlertTriangle : RefreshCw
  return (
    <div className={`rounded-xl p-4 mb-6 border flex items-start gap-3 ${styles[kind]}`}>
      <Icon size={18} className="flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <strong className="block mb-0.5">{title}</strong>
        <span className="text-muted-foreground">{children}</span>
      </div>
    </div>
  )
}

function Perk({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-xl p-4 bg-muted/30 border border-border">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  )
}

function ManageCards({ showCancel, resumeLabel }: { showCancel: boolean; resumeLabel?: string }) {
  return (
    <Section title="Manage subscription" description="Update your card, download invoices, or change your plan details">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PortalCard
          href="/api/stripe/portal"
          icon={<Receipt size={18} />}
          title={resumeLabel ?? 'Open billing portal'}
          subtitle="Invoices, payment history, receipts, resume sub"
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
        You&apos;ll be redirected to Stripe. Nexley never sees or stores your card details. {!showCancel && 'Cancellation is scheduled — use the portal to resume.'}
      </p>
    </Section>
  )
}

function DangerCancel() {
  return (
    <Section title="Cancel subscription" description="Stop future £599 billing — your agent stays live until the end of the current period" className="border-red-500/20">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/5 border border-red-500/20 mb-4">
        <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          <strong className="text-red-400 block mb-1">Before you cancel:</strong>
          Your agent will keep answering calls and WhatsApp messages until the end of your current billing period. Your data (call logs, contacts, pipeline) is retained for 30 days under UK GDPR — after that it&apos;s permanently deleted.
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
  )
}

function PortalCard({ href, icon, title, subtitle, primary = false }: { href: string; icon: React.ReactNode; title: string; subtitle: string; primary?: boolean }) {
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

function niceDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

function formatAmount(pence: number | null | undefined) {
  if (pence == null) return '£—'
  const pounds = pence / 100
  return pounds % 1 === 0 ? `£${pounds.toFixed(0)}` : `£${pounds.toFixed(2)}`
}
