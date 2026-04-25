import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { verifyHmacSha256Hex } from '@/lib/webhooks/verify-signature'

/**
 * Critical-path test (P2 #7 + devil's-advocate round 2):
 *
 * The previous version of this file defined its OWN verifier inline and
 * tested that — which gave false confidence (the production code could
 * be wildly broken and these tests would still pass).
 *
 * This rewrite imports the real `verifyHmacSha256Hex` from
 * lib/webhooks/verify-signature.ts — the EXACT same function used by
 * /api/webhook/instantly/route.ts. So a regression in the verifier
 * actually fails the test.
 *
 * Stripe webhooks use the SDK's own `stripe.webhooks.constructEvent`
 * which is integration-tested separately (Stripe owns that code).
 */

const SECRET = 'whsec_test-1234567890abcdef'

describe('verifyHmacSha256Hex (used by /api/webhook/instantly)', () => {
  const body = '{"event_type":"email.replied","lead":{"email":"a@b.com"}}'

  it('accepts a correctly-signed body', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifyHmacSha256Hex(body, sig, SECRET)).toBe(true)
  })

  it('rejects when the body is tampered post-signing', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    const tampered = body.replace('a@b.com', 'attacker@evil.com')
    expect(verifyHmacSha256Hex(tampered, sig, SECRET)).toBe(false)
  })

  it('rejects when signed with a different secret (forgery)', () => {
    const forged = crypto.createHmac('sha256', 'whsec_attacker-key').update(body).digest('hex')
    expect(verifyHmacSha256Hex(body, forged, SECRET)).toBe(false)
  })

  it('rejects truncated signature without throwing', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifyHmacSha256Hex(body, sig.slice(0, -10), SECRET)).toBe(false)
  })

  it('rejects when secret is missing', () => {
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifyHmacSha256Hex(body, sig, '')).toBe(false)
    expect(verifyHmacSha256Hex(body, sig, null)).toBe(false)
    expect(verifyHmacSha256Hex(body, sig, undefined)).toBe(false)
  })

  it('rejects when signature is missing', () => {
    expect(verifyHmacSha256Hex(body, '', SECRET)).toBe(false)
    expect(verifyHmacSha256Hex(body, null, SECRET)).toBe(false)
    expect(verifyHmacSha256Hex(body, undefined, SECRET)).toBe(false)
  })

  it('rejects when body is empty', () => {
    const sig = crypto.createHmac('sha256', SECRET).update('').digest('hex')
    // Even with a "valid" signature for empty body, we treat empty as
    // not-a-real-payload and reject.
    expect(verifyHmacSha256Hex('', sig, SECRET)).toBe(false)
  })

  it('does not throw on garbage input', () => {
    expect(() => verifyHmacSha256Hex(body, 'not-hex-at-all', SECRET)).not.toThrow()
    expect(verifyHmacSha256Hex(body, 'not-hex-at-all', SECRET)).toBe(false)
  })
})
