import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { verifyStripeSignature, STRIPE_REPLAY_TOLERANCE_SECONDS } from '@/lib/webhooks/stripe-signature'

/**
 * Stripe webhook signature test (round-3 fix P1 #2).
 *
 * Imports the EXACT verifier the production /api/webhook/stripe route
 * uses. A regression in the verifier now fails this test.
 *
 * Coverage: replay-attack window, forged signatures, malformed headers,
 * timing-safe-equal correctness on length mismatches.
 *
 * What we don't cover here: full route invocation. That's an integration
 * concern (needs a working Supabase) and lives in the staging-environment
 * test plan documented in docs/operations/STAGING-ENVIRONMENT.md.
 */

const SECRET = 'whsec_test-signing-secret'

function signEvent(payload: string, secret: string, t: number): string {
  const signed = `${t}.${payload}`
  const v1 = crypto.createHmac('sha256', secret).update(signed).digest('hex')
  return `t=${t},v1=${v1}`
}

describe('verifyStripeSignature (used by /api/webhook/stripe)', () => {
  const body = '{"id":"evt_test","type":"customer.subscription.deleted"}'
  const now = Math.floor(Date.now() / 1000)

  it('accepts a valid, fresh signature', () => {
    const sig = signEvent(body, SECRET, now)
    expect(verifyStripeSignature(body, sig, SECRET, now)).toBe(true)
  })

  it('rejects when body is tampered post-signing', () => {
    const sig = signEvent(body, SECRET, now)
    const tampered = body.replace('subscription.deleted', 'subscription.created')
    expect(verifyStripeSignature(tampered, sig, SECRET, now)).toBe(false)
  })

  it('rejects when signed with the wrong secret', () => {
    const forgedSig = signEvent(body, 'whsec_attacker', now)
    expect(verifyStripeSignature(body, forgedSig, SECRET, now)).toBe(false)
  })

  it('rejects timestamp older than the replay tolerance', () => {
    const oldT = now - STRIPE_REPLAY_TOLERANCE_SECONDS - 60  // 1 min past tolerance
    const oldSig = signEvent(body, SECRET, oldT)
    expect(verifyStripeSignature(body, oldSig, SECRET, now)).toBe(false)
  })

  it('rejects timestamp from far future (clock-skew attack)', () => {
    const futureT = now + STRIPE_REPLAY_TOLERANCE_SECONDS + 60
    const futureSig = signEvent(body, SECRET, futureT)
    expect(verifyStripeSignature(body, futureSig, SECRET, now)).toBe(false)
  })

  it('rejects malformed signature header', () => {
    expect(verifyStripeSignature(body, 'gibberish', SECRET, now)).toBe(false)
    expect(verifyStripeSignature(body, '', SECRET, now)).toBe(false)
    expect(verifyStripeSignature(body, 't=abc,v1=xyz', SECRET, now)).toBe(false)
  })

  it('rejects header missing the v1 element', () => {
    expect(verifyStripeSignature(body, `t=${now}`, SECRET, now)).toBe(false)
  })

  it('rejects truncated v1 hex (length mismatch)', () => {
    const sig = signEvent(body, SECRET, now)
    const truncated = sig.replace(/[a-f0-9]{8}$/, '')
    expect(verifyStripeSignature(body, truncated, SECRET, now)).toBe(false)
  })

  it('rejects when secret is missing', () => {
    const sig = signEvent(body, SECRET, now)
    expect(verifyStripeSignature(body, sig, '', now)).toBe(false)
  })

  it('does not throw on adversarial inputs', () => {
    expect(() => verifyStripeSignature('', '', '', 0)).not.toThrow()
    expect(() => verifyStripeSignature(body, 't=NaN,v1=zzz', SECRET, now)).not.toThrow()
  })

  it('replay tolerance constant is 300s (5min)', () => {
    expect(STRIPE_REPLAY_TOLERANCE_SECONDS).toBe(300)
  })
})
