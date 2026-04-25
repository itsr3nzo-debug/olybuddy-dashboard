import { describe, expect, it } from 'vitest'
import { normalizePhone } from '@/lib/phone'

describe('normalizePhone', () => {
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

  it('strips spaces, dashes, parens, dots', () => {
    expect(normalizePhone('07123 456 789')).toBe('+447123456789')
    expect(normalizePhone('0712-345-6789')).toBe('+447123456789')
    expect(normalizePhone('(07123) 456789')).toBe('+447123456789')
    expect(normalizePhone('07123.456.789')).toBe('+447123456789')
  })

  it('returns null for empty / too-short input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('07123')).toBeNull()
  })
})
