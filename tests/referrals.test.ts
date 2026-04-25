import { describe, expect, it } from 'vitest'
import { REFERRAL_CREDIT_PENCE } from '@/lib/referrals'

describe('referrals constants', () => {
  it('REFERRAL_CREDIT_PENCE is exactly £150 in pence', () => {
    expect(REFERRAL_CREDIT_PENCE).toBe(15000)
  })

  it('4 × credit covers a monthly £599 invoice', () => {
    // 4 credits = £600. The £1 over isn't refunded — just makes the month
    // free. Anything bigger would be a windfall.
    expect(REFERRAL_CREDIT_PENCE * 4).toBeGreaterThanOrEqual(59900)
  })
})
