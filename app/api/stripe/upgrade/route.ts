import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getUserSession } from '@/lib/rbac'

// Max 5 Stripe Checkout / end-trial attempts per 10 min per user. Each call
// makes 1-3 Stripe API requests; without a cap a logged-in user could trip
// Stripe rate limits for the whole account or pile up abandoned Checkout
// sessions.
const RATE_LIMIT = 5
const RATE_WINDOW_MINUTES = 10

/**
 * GET /api/stripe/upgrade
 *
 * Starts the billing flow for a LOGGED-IN client. Matches the same pattern as
 * `/api/signup` (mode=payment, £20 onboarding, 5-day trial, £599/mo) but for
 * existing users. Used in three cases:
 *
 *   1. Legacy client never went through Stripe (no stripe_customer_id)
 *      → "Set up billing" button on /settings/billing
 *   2. Previously cancelled client wants to come back
 *      → "Reactivate" button on /settings/billing
 *   3. A trial user whose trial is about to expire clicks upgrade
 *      → they pay £20 now and start a fresh 5-day trial
 *
 * Safe against double-subscription: if they already have an ACTIVE sub,
 * we redirect them to the portal (where they can manage it) instead of
 * creating a second one.
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll() {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Rate-limit per user via the same Supabase-backed rate_limit_events table
  // signup uses. Serverless-safe (no in-memory state). Blocks abuse without
  // affecting legitimate retries spaced minutes apart.
  try {
    const { getSupabase } = await import('@/lib/supabase')
    const admin = getSupabase()
    const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
    const { count } = await admin
      .from('rate_limit_events')
      .select('id', { count: 'exact', head: true })
      .eq('key', `upgrade:${user.id}`)
      .gte('created_at', windowStart)
    if ((count ?? 0) >= RATE_LIMIT) {
      return NextResponse.redirect(
        new URL('/settings/billing?error=rate_limited', req.url)
      )
    }
    await admin.from('rate_limit_events').insert({ key: `upgrade:${user.id}` })
  } catch (e) {
    // If rate-limit bookkeeping fails, log but proceed — don't lock users out
    // on a transient Supabase blip.
    console.warn('[stripe upgrade] rate limit check failed:', e)
  }

  const session = getUserSession(user)
  if (!session.clientId) {
    return NextResponse.redirect(new URL('/dashboard?error=no_client', req.url))
  }

  const { getSupabase } = await import('@/lib/supabase')
  const adminSupabase = getSupabase()
  const { data: client } = await adminSupabase
    .from('clients')
    .select('email, name, stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('id', session.clientId)
    .single()

  if (!client) {
    return NextResponse.redirect(new URL('/dashboard?error=no_client', req.url))
  }

  // PAYMENT IN FLIGHT — they just completed Checkout but webhook hasn't
  // fired yet. Creating a second Checkout here risks charging them twice.
  // Redirect back to billing where the "Finalising your payment" UI waits
  // (the page derives that state from Supabase; no query param needed).
  if (client.subscription_status === 'pending_payment') {
    return NextResponse.redirect(new URL('/settings/billing', req.url))
  }

  // TRIALING with an active sub → end the trial immediately via Stripe.
  // Stripe creates the first invoice and attempts to charge the saved card.
  // If the charge succeeds, sub.status becomes 'active' and we show a success
  // banner. If the charge fails, sub.status becomes 'past_due' and we route
  // them to the payment-method-update portal flow (NOT the success banner —
  // that would be a lie).
  if (client.stripe_subscription_id && client.subscription_status === 'trial') {
    try {
      const { getStripe } = await import('@/lib/stripe')
      const updated = await getStripe().subscriptions.update(client.stripe_subscription_id, {
        trial_end: 'now',
        proration_behavior: 'none',
      })

      // Stripe's response tells us whether the transition charge cleared.
      // 'active' = charged, 'past_due'/'unpaid'/'incomplete' = charge failed
      // (card declined, insufficient funds, SCA required, etc).
      if (updated.status === 'active' || updated.status === 'trialing') {
        return NextResponse.redirect(
          new URL('/settings/billing?upgraded_early=1', req.url)
        )
      }
      // Charge failed. Send them to update the card directly.
      console.warn('[stripe upgrade] end-trial returned non-active status:', updated.status)
      return NextResponse.redirect(
        new URL('/api/stripe/portal?flow=payment', req.url)
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('[stripe upgrade] end-trial failed:', err?.message)
      return NextResponse.redirect(
        new URL('/settings/billing?error=checkout_failed', req.url)
      )
    }
  }

  // Already paying or past-due → send them to the portal. Creating a second
  // subscription for an already-subscribed customer would double-bill them.
  // 'paused' is the past_due/unpaid case — they need to update the card.
  if (
    client.stripe_subscription_id &&
    ['active', 'paused'].includes(client.subscription_status ?? '')
  ) {
    const portalUrl = client.subscription_status === 'paused'
      ? '/api/stripe/portal?flow=payment'
      : '/api/stripe/portal'
    return NextResponse.redirect(new URL(portalUrl, req.url))
  }

  const trialPriceId = process.env.STRIPE_PRICE_TRIAL
  const subscriptionPriceId = process.env.STRIPE_PRICE_EMPLOYEE
  if (
    !trialPriceId || !subscriptionPriceId ||
    trialPriceId.startsWith('price_PLACEHOLDER') ||
    subscriptionPriceId.startsWith('price_PLACEHOLDER')
  ) {
    return NextResponse.redirect(new URL('/settings/billing?error=stripe_not_configured', req.url))
  }

  const { getStripe } = await import('@/lib/stripe')
  const stripe = getStripe()

  // Reuse the existing Stripe customer if we already have one on file. This
  // avoids creating duplicate customer records when someone reactivates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerParam: any = client.stripe_customer_id
    ? { customer: client.stripe_customer_id }
    : { customer_email: client.email ?? user.email, customer_creation: 'always' }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...customerParam,
      metadata: {
        client_id: session.clientId,
        plan: 'employee',
        business_name: client.name ?? '',
        upgrade_from: client.subscription_status ?? 'legacy',
        create_subscription_price: subscriptionPriceId,
        subscription_trial_days: '5',
        user_id: user.id,
      },
      line_items: [{ price: trialPriceId, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: { client_id: session.clientId, purpose: 'onboarding_fee' },
      },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing?upgraded=1`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing?upgrade_cancelled=1`,
    })

    if (!checkoutSession.url) {
      return NextResponse.redirect(new URL('/settings/billing?error=checkout_failed', req.url))
    }
    return NextResponse.redirect(checkoutSession.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[stripe upgrade] checkout create failed:', err?.message)
    return NextResponse.redirect(new URL('/settings/billing?error=checkout_failed', req.url))
  }
}
