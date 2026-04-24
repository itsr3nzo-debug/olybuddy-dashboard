import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getUserSession } from '@/lib/rbac'

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

  // TRIALING with an active sub → end the trial immediately via Stripe.
  // Stripe will charge £599 NOW, the subscription.updated webhook flips
  // status='active', and the customer "upgrades" straight from £20 trial to
  // paid. No second checkout needed — card is already on file.
  if (client.stripe_subscription_id && client.subscription_status === 'trial') {
    try {
      const { getStripe } = await import('@/lib/stripe')
      await getStripe().subscriptions.update(client.stripe_subscription_id, {
        trial_end: 'now',
        proration_behavior: 'none',
      })
      return NextResponse.redirect(
        new URL('/settings/billing?upgraded_early=1', req.url)
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
