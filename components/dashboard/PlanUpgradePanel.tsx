import { createClient } from '@/lib/supabase/server'
import { Sparkles, ArrowRight, CheckCircle2, Zap } from 'lucide-react'

type ClientRow = {
  id: string
  email: string | null
  subscription_status: string | null
  subscription_plan: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  trial_ends_at: string | null
}

// Internal Nexley team accounts don't pay for the product. Suppress the
// billing CTAs so the admin/demo clients aren't nagged to "Set up billing".
function isInternalAccount(client: ClientRow): boolean {
  if (client.email?.toLowerCase().endsWith('@nexley.ai')) return true
  if (client.subscription_plan === 'enterprise') return true
  return false
}

/**
 * Prominent plan-status panel on the dashboard home. Renders one of:
 *
 *   - 'trial' with active Stripe sub → "Upgrade to paid now · £599/mo"
 *     (ends trial early via /api/stripe/upgrade)
 *   - legacy (no Stripe customer) → "Set up billing · £20"
 *     (kicks off Stripe Checkout)
 *   - cancelled → "Reactivate · £20"
 *   - past_due → "Update payment method"
 *   - active paying → returns null (nothing to upgrade)
 *
 * Designed to be the FIRST thing a non-paying customer sees on the dashboard
 * so the upgrade path is obvious. Single card, single CTA — no decision
 * paralysis.
 */
export default async function PlanUpgradePanel({ clientId }: { clientId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('clients')
    .select('id, email, subscription_status, subscription_plan, stripe_customer_id, stripe_subscription_id, trial_ends_at')
    .eq('id', clientId)
    .single()

  const client = data as ClientRow | null
  if (!client) return null

  // Internal Nexley team accounts — hide the nag
  if (isInternalAccount(client)) return null

  // Active paying customer — no upgrade panel needed
  if (
    client.subscription_status === 'active' &&
    client.stripe_subscription_id &&
    client.subscription_plan === 'employee'
  ) {
    return null
  }

  // PAYMENT IN FLIGHT — customer just completed Stripe Checkout but our
  // webhook hasn't fired yet (usually a 2-15 second window). Showing
  // "Set up billing — £20" here would be wrong: they've already paid,
  // we just haven't received Stripe's confirmation. Also we MUST NOT point
  // them at /api/stripe/upgrade here — that would create a SECOND Checkout
  // and they could double-pay. Just show a reassuring "processing" panel.
  if (
    client.subscription_status === 'pending_payment' &&
    !client.stripe_subscription_id
  ) {
    return (
      <Panel
        variant="indigo"
        title="Finalising your payment…"
        subtitle="Stripe is confirming the charge. This page will update automatically once it lands (usually within 15 seconds). Refresh if you don&apos;t see anything after a minute."
        ctaLabel="Refresh"
        ctaHref="/dashboard"
      />
    )
  }

  // Past-due — red urgent panel
  if (client.subscription_status === 'paused') {
    return (
      <Panel
        variant="warning"
        title="Payment failed — update your card"
        subtitle="Your most recent £599 charge was declined. Update your payment method now to keep your AI Employee live."
        ctaLabel="Update payment method"
        ctaHref="/api/stripe/portal?flow=payment"
      />
    )
  }

  // Cancelled — reactivation panel
  if (client.subscription_status === 'cancelled') {
    return (
      <Panel
        variant="indigo"
        title="Come back — £19.99 gets you a fresh 5-day trial"
        subtitle="Reactivate and your previous config is restored. Then £599/mo auto-starts from Day 6 unless you cancel again."
        ctaLabel="Reactivate — £19.99"
        ctaHref="/api/stripe/upgrade"
      />
    )
  }

  // Trial WITH active Stripe sub — they paid £20, can upgrade to paid early
  if (
    client.subscription_status === 'trial' &&
    client.stripe_subscription_id
  ) {
    const daysLeft = client.trial_ends_at
      ? Math.max(0, Math.ceil(
          (new Date(client.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        ))
      : null
    const endDate = client.trial_ends_at
      ? new Date(client.trial_ends_at).toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long',
        })
      : null
    return (
      <Panel
        variant="indigo"
        trial
        daysLeft={daysLeft}
        title={
          daysLeft && daysLeft > 0
            ? `You're on a 5-day trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
            : 'Your trial converts today'
        }
        subtitle={
          endDate
            ? `Your card will be auto-billed £599 on ${endDate}. Want to skip the wait and upgrade now?`
            : 'Your card will be auto-billed £599 at trial end. Want to skip the wait and upgrade now?'
        }
        ctaLabel="Upgrade to paid — £599/mo"
        ctaHref="/api/stripe/upgrade"
        secondaryHref="/settings/billing"
        secondaryLabel="Manage subscription"
      />
    )
  }

  // Legacy / fresh signup without Stripe yet — needs to set up billing
  return (
    <Panel
      variant="indigo"
      title="Set up billing to keep your AI Employee running"
      subtitle="£19.99 today unlocks a 5-day trial on your existing server. £599/mo kicks in on Day 6 — cancel anytime before."
      ctaLabel="Set up billing — £19.99"
      ctaHref="/api/stripe/upgrade"
      secondaryHref="/settings/billing"
      secondaryLabel="View billing details"
    />
  )
}

// ─── Panel UI ───────────────────────────────────────────────────────────

type PanelProps = {
  variant: 'indigo' | 'warning'
  title: string
  subtitle: string
  ctaLabel: string
  ctaHref: string
  secondaryLabel?: string
  secondaryHref?: string
  trial?: boolean
  daysLeft?: number | null
}

/**
 * Panel — v2.
 *
 * Stripped of:
 * - Indigo→violet gradient bg + decorative blur circle
 * - Coloured icon tile (was 48×48 rounded-xl with Sparkles inside)
 * - Gradient CTA button with shadow
 * - Pill-shaped days-left counter
 *
 * Replaced with:
 * - Hairline-bordered card + 2px primary accent strip on the left
 *   (matches <Card variant="hero">). Reads "important" without being
 *   visually loud.
 * - Mono days-left counter inline with title
 * - Primary solid-navy CTA (Button default variant), no gradient
 * - Secondary as a ghost link
 *
 * The single accent strip is what carries the eye now — no need for
 * gradient hero treatments. DA review confirmed keeping the visual
 * priority but losing the AI-generated styling.
 */
function Panel({
  variant, title, subtitle, ctaLabel, ctaHref, secondaryLabel, secondaryHref, trial, daysLeft,
}: PanelProps) {
  const isWarning = variant === 'warning'
  const Icon = isWarning ? Zap : Sparkles
  const stripStyle = isWarning
    ? 'shadow-[inset_2px_0_0_0_var(--brand-danger)]'
    : 'shadow-[inset_2px_0_0_0_var(--primary)]'
  const iconColor = isWarning ? 'text-destructive' : 'text-primary'

  return (
    <section
      className={`relative overflow-hidden rounded-lg border border-border bg-card ${stripStyle} p-4 sm:p-5 mb-6`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        {/* Icon — small, no tile */}
        <Icon
          aria-hidden
          size={20}
          strokeWidth={1.5}
          className={`shrink-0 ${iconColor}`}
        />

        {/* Title + subtitle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-foreground tracking-tight leading-tight">
              {title}
            </h3>
            {trial && daysLeft !== null && daysLeft !== undefined && daysLeft > 0 && (
              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                {daysLeft} day{daysLeft === 1 ? '' : 's'} left
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 leading-snug">
            {subtitle}
          </p>
        </div>

        {/* CTAs — solid primary + ghost secondary */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={ctaHref}
            className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isWarning
                ? 'bg-destructive text-white hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {ctaLabel}
            <ArrowRight size={14} strokeWidth={1.75} />
          </a>
          {secondaryHref && secondaryLabel && (
            <a
              href={secondaryHref}
              className="inline-flex items-center justify-center h-9 px-3 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors whitespace-nowrap"
            >
              {secondaryLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
