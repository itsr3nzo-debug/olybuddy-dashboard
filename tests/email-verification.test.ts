import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
// We import only the pure helper — verifyEmailToken/sendVerificationEmail
// would require Supabase + SMTP setup so they live in tests/integration/.
import { hashToken, VERIFICATION_TTL_HOURS } from '@/lib/auth/email-verification'

describe('hashToken', () => {
  it('produces SHA-256 hex', () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const expected = crypto.createHash('sha256').update(token).digest('hex')
    expect(hashToken(token)).toBe(expected)
  })

  it('TTL is at least 1 hour and under a week', () => {
    expect(VERIFICATION_TTL_HOURS).toBeGreaterThanOrEqual(1)
    expect(VERIFICATION_TTL_HOURS).toBeLessThanOrEqual(168)
  })

  it('different tokens hash differently', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'))
  })
})
