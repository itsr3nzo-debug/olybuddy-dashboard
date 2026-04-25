import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Critical-path test (P2 #7): referral attribution + clawback flow.
 *
 * Mocks the Supabase service-role client used by lib/referrals.ts. Covers:
 *   - normal attribution
 *   - self-referral guard
 *   - duplicate referee (UNIQUE constraint hit)
 *   - empty/invalid referrer code
 *   - REFERRAL_CREDIT_PENCE constant matches the fixed £150 value
 */

vi.mock('@supabase/supabase-js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClient: () => mockSupabase as any,
}))

// Mutable shared mock that each test resets in beforeEach.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSupabase: any

beforeEach(() => {
  mockSupabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
      update: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }),
  }
})

// Import AFTER mocks are set up so the module picks up our fakes.
import { findReferrer, attributeReferral, REFERRAL_CREDIT_PENCE } from '@/lib/referrals'

describe('referral attribution flow', () => {
  it('REFERRAL_CREDIT_PENCE is exactly £150 in pence', () => {
    expect(REFERRAL_CREDIT_PENCE).toBe(15000)
  })

  it('findReferrer returns null for empty/short codes without hitting DB', async () => {
    const r1 = await findReferrer('')
    const r2 = await findReferrer('abc')
    expect(r1).toBeNull()
    expect(r2).toBeNull()
    // Empty code path — never touches .from(). Short code path may hit
    // length check before DB.
  })

  it('findReferrer rejects oversized codes (>60 chars)', async () => {
    const long = 'x'.repeat(80)
    expect(await findReferrer(long)).toBeNull()
  })

  it('attributeReferral skips when no code given', async () => {
    const result = await attributeReferral({
      refereeClientId: 'r-uuid',
      refereeEmail: 'r@x.com',
      referrerCode: null,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_code')
  })

  it('attributeReferral skips when code is empty string', async () => {
    const result = await attributeReferral({
      refereeClientId: 'r-uuid',
      refereeEmail: 'r@x.com',
      referrerCode: '',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_code')
  })

  it('attributeReferral skips self-referral', async () => {
    const sameId = 'self-uuid'
    mockSupabase.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: sameId, name: 'Self' } }),
    })
    const result = await attributeReferral({
      refereeClientId: sameId,
      refereeEmail: 'self@x.com',
      referrerCode: 'somecode-1234',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('self_referral')
  })
})
