import { describe, expect, it } from 'vitest'
import { normalizePhone, normalizePhoneDigits } from '@/lib/phone'

describe('normalizePhone — UK', () => {
  it('handles UK 07xxx domestic format', () => {
    expect(normalizePhone('07123456789')).toBe('+447123456789')
  })

  it('handles +44 international format unchanged', () => {
    expect(normalizePhone('+447123456789')).toBe('+447123456789')
  })

  it('handles 0044 international prefix', () => {
    expect(normalizePhone('00447123456789')).toBe('+447123456789')
  })

  it('handles 44xxx without + prefix', () => {
    expect(normalizePhone('447123456789')).toBe('+447123456789')
  })

  it('strips spaces, dashes, parens, dots from UK numbers', () => {
    expect(normalizePhone('07123 456 789')).toBe('+447123456789')
    expect(normalizePhone('0712-345-6789')).toBe('+447123456789')
    expect(normalizePhone('(07123) 456789')).toBe('+447123456789')
    expect(normalizePhone('07123.456.789')).toBe('+447123456789')
    expect(normalizePhone('+44 7123 456 789')).toBe('+447123456789')
  })
})

describe('normalizePhone — international (non-UK customers)', () => {
  it('handles Ireland +353', () => {
    expect(normalizePhone('+353871234567')).toBe('+353871234567')
    expect(normalizePhone('+353 87 123 4567')).toBe('+353871234567')
    expect(normalizePhone('00353871234567')).toBe('+353871234567')
    expect(normalizePhone('353871234567')).toBe('+353871234567')
  })

  it('handles India +91', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210')
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210')
    expect(normalizePhone('00919876543210')).toBe('+919876543210')
    expect(normalizePhone('919876543210')).toBe('+919876543210')
  })

  it('handles US/Canada +1', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567')
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567')
    expect(normalizePhone('001 555 123 4567')).toBe('+15551234567')
  })

  it('handles Australia +61', () => {
    expect(normalizePhone('+61412345678')).toBe('+61412345678')
    expect(normalizePhone('0061 412 345 678')).toBe('+61412345678')
  })

  it('handles France +33', () => {
    expect(normalizePhone('+33612345678')).toBe('+33612345678')
  })
})

describe('normalizePhone — invalid input', () => {
  it('returns null for empty / too-short input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('07123')).toBeNull()
    expect(normalizePhone('+1234')).toBeNull()
  })

  it('returns null for too-long input', () => {
    expect(normalizePhone('+1234567890123456')).toBeNull()
  })

  it('returns null for invalid country code (leading 0 after +)', () => {
    expect(normalizePhone('+0447123456789')).toBeNull()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  it('returns null for non-string input', () => {
    expect(normalizePhone(null as any)).toBeNull()
    expect(normalizePhone(undefined as any)).toBeNull()
  })
})

describe('normalizePhoneDigits — storage form (no leading +)', () => {
  it('returns digits-only for valid input', () => {
    expect(normalizePhoneDigits('07123456789')).toBe('447123456789')
    expect(normalizePhoneDigits('+353871234567')).toBe('353871234567')
    expect(normalizePhoneDigits('+919876543210')).toBe('919876543210')
  })

  it('returns null for invalid input', () => {
    expect(normalizePhoneDigits('')).toBeNull()
    expect(normalizePhoneDigits('not a phone')).toBeNull()
  })
})
