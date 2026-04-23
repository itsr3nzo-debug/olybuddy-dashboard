import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getUserSession } from '@/lib/rbac'

/**
 * GET /api/stripe/portal
 *
 * Opens the Stripe Customer Portal for the authenticated user. The portal is
 * Stripe-hosted so customers can:
 *   - Update payment method
 *   - Download invoices + view billing history
 *   - Cancel their subscription (at period end — agent stays live until then)
 *   - Update billing details (email, phone, address, tax ID)
 *
 * Optional `?flow=X` query parameter for deep-linked actions:
 *   ?flow=payment → opens the "update payment method" flow directly
 *   ?flow=cancel  → opens the "cancel subscription" flow directly
 *   (no flow)     → opens portal home with all tabs
 *
 * Returns a 302 redirect to the Stripe-hosted portal URL.
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

  // Look up the client's Stripe customer ID. This is set by the stripe webhook
  // on checkout.session.completed, so clients who never finished Stripe
  // Checkout (pre-billing-wire-up trials, failed payments) won't have one.
  const { getSupabase } = await import('@/lib/supabase')
  const adminSupabase = getSupabase()
  const { data: client } = await adminSupabase
    .from('clients')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('id', session.clientId)
    .single()

  if (!client?.stripe_customer_id) {
    // No Stripe customer yet — shouldn't happen in the new flow (every signup
    // goes through Checkout), but handle legacy trials gracefully.
    return NextResponse.redirect(
      new URL('/settings/billing?error=no_subscription', req.url)
    )
  }

  // Build the portal session. flow_data lets us deep-link into specific actions
  // (e.g. "Cancel" button goes straight to the cancellation flow).
  const flow = req.nextUrl.searchParams.get('flow')
  const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing?portal_return=1`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = {
    customer: client.stripe_customer_id,
    return_url: returnUrl,
  }

  if (flow === 'payment') {
    params.flow_data = {
      type: 'payment_method_update',
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    }
  } else if (flow === 'cancel' && client.stripe_subscription_id) {
    params.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: client.stripe_subscription_id },
      after_completion: { type: 'redirect', redirect: { return_url: returnUrl } },
    }
  }

  try {
    const { getStripe } = await import('@/lib/stripe')
    const portalSession = await getStripe().billingPortal.sessions.create(params)
    if (!portalSession.url) {
      return NextResponse.redirect(new URL('/settings/billing?error=portal_failed', req.url))
    }
    return NextResponse.redirect(portalSession.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[stripe portal] failed:', err?.message)
    return NextResponse.redirect(new URL('/settings/billing?error=portal_failed', req.url))
  }
}
