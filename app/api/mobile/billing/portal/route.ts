/**
 * POST /api/mobile/billing/portal
 *
 * Returns a Stripe customer-portal URL the mobile app opens in WebBrowser.
 * Reuses the existing /api/stripe/portal pattern but accepts mobile JWT
 * auth instead of cookie session.
 *
 * Apple guideline note: SaaS billing via web portal (not in-app purchase)
 * is permitted for B2B services — this is the same pattern Slack/Notion
 * use on iOS.
 */

import Stripe from 'stripe'
import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexley.vercel.app'

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    const sb = createUntypedServiceClient()
    const { data: client, error } = await sb
      .from('clients')
      .select('stripe_customer_id')
      .eq('id', clientId)
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!client?.stripe_customer_id) {
      throw Errors.validation({ message: 'No Stripe customer for this account.' })
    }

    if (!STRIPE_KEY) throw Errors.internal('Stripe not configured')
    const stripe = new Stripe(STRIPE_KEY)
    const session = await stripe.billingPortal.sessions.create({
      customer: client.stripe_customer_id as string,
      return_url: `${SITE_URL}/mobile/billing-return`,
    })

    return jsonResponse({ url: session.url }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
