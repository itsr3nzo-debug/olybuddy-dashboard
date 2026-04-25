/**
 * Stripe webhook signature verification — extracted from the inline
 * function in /api/webhook/stripe/route.ts so it's directly testable
 * (round-3 fix P1 #2).
 *
 * Stripe sends a `Stripe-Signature` header of the form:
 *     t=<timestamp>,v1=<hex>
 * where v1 is HMAC-SHA256 of `<timestamp>.<body>` keyed by the webhook
 * signing secret. We:
 *   1. Parse out t and v1
 *   2. Reject if the timestamp is >5min old (replay protection)
 *   3. Re-compute the expected v1 HMAC and compare in constant time
 *
 * Returns true iff the signature is valid + fresh, false otherwise.
 * Never throws.
 */
import crypto from 'crypto'

export const STRIPE_REPLAY_TOLERANCE_SECONDS = 300

export function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  try {
    if (!payload || !signature || !secret) return false
    const elements = signature.split(',')
    const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1]
    const v1Sig = elements.find(e => e.startsWith('v1='))?.split('=')[1]

    if (!timestamp || !v1Sig) return false

    const age = nowSeconds - parseInt(timestamp, 10)
    if (Number.isNaN(age) || age > STRIPE_REPLAY_TOLERANCE_SECONDS || age < -STRIPE_REPLAY_TOLERANCE_SECONDS) {
      return false
    }

    const signedPayload = `${timestamp}.${payload}`
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    const actual = Buffer.from(v1Sig, 'utf8')
    const expected = Buffer.from(expectedSig, 'utf8')
    if (actual.length !== expected.length) return false
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
