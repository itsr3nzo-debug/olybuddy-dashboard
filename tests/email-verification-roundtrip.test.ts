import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { hashToken, VERIFICATION_TTL_HOURS } from '@/lib/auth/email-verification'

/**
 * Critical-path test (P2 #7): email-verification token round-trip.
 *
 * The token shown in the verification email is the raw 32-byte hex value;
 * the DB stores SHA-256 of that. This test makes sure:
 *   - the same raw token always produces the same hash
 *   - the comparison only succeeds when the raw token matches the stored hash
 *   - constant-time compare semantics hold for buffers of equal length
 *   - the TTL is sane (not 0, not infinite)
 */

describe('email verification token round-trip', () => {
  it('hashes the same input deterministically', () => {
    const raw = crypto.randomBytes(32).toString('hex')
    expect(hashToken(raw)).toBe(hashToken(raw))
  })

  it('different raw tokens yield different hashes', () => {
    const a = crypto.randomBytes(32).toString('hex')
    const b = crypto.randomBytes(32).toString('hex')
    expect(hashToken(a)).not.toBe(hashToken(b))
  })

  it('a raw token validates against its own hash via timingSafeEqual', () => {
    const raw = crypto.randomBytes(32).toString('hex')
    const stored = hashToken(raw)
    const incomingHash = hashToken(raw)
    expect(incomingHash.length).toBe(stored.length)
    expect(crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(stored))).toBe(true)
  })

  it('a different raw token does NOT validate against a stored hash', () => {
    const realRaw = crypto.randomBytes(32).toString('hex')
    const stored = hashToken(realRaw)
    const guess = crypto.randomBytes(32).toString('hex')
    const guessHash = hashToken(guess)
    expect(crypto.timingSafeEqual(Buffer.from(guessHash), Buffer.from(stored))).toBe(false)
  })

  it('TTL is between 1 hour and 7 days', () => {
    expect(VERIFICATION_TTL_HOURS).toBeGreaterThanOrEqual(1)
    expect(VERIFICATION_TTL_HOURS).toBeLessThanOrEqual(168)
  })
})
