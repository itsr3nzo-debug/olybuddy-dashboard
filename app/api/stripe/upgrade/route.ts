import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { PLAN_PRICES } from '@/lib/stripe'
import { getUserSession } from '@/lib/rbac'

export async function GET(req: NextRequest) {
  // Auth check
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
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Get client's current plan to determine upgrade target
  const { getSupabase } = await import('@/lib/supabase')
  const adminSupabase = getSupabase()
  const { data: client } = await adminSupabase
    .from('clients')
    .select('email, name, stripe_customer_id, subscription_plan')
    .eq('id', session.clientId)
    .single()

  if (!client) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Default upgrade to 'starter' plan
  const upgradePlan = 'starter'
  const priceId = PLAN_PRICES[upgradePlan]

  if (!priceId) {
    return NextResponse.redirect(new URL('/dashboard?error=stripe_not_configured', req.url))
  }

  // Create Stripe Checkout session
  const { getStripe } = await import('@/lib/stripe')
  const checkoutSession = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: client.email ?? user.email,
    metadata: {
      client_id: session.clientId,
      plan: upgradePlan,
      upgrade_from: 'trial',
    },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard?upgrade_cancelled=true`,
  })

  if (!checkoutSession.url) {
    return NextResponse.redirect(new URL('/dashboard?error=checkout_failed', req.url))
  }

  return NextResponse.redirect(checkoutSession.url)
}
