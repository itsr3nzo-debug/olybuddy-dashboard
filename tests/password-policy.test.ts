import { describe, expect, it } from 'vitest'
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/lib/password-policy'

describe('validatePassword', () => {
  it('rejects passwords below the minimum length', () => {
    const result = validatePassword('Short1!')
    expect(result.error).toMatch(/at least \d+ characters/)
    expect(result.rules.length).toBe(false)
  })

  it('accepts a strong, well-formed password', () => {
    const result = validatePassword('CorrectHorseBattery42!')
    expect(result.error).toBeNull()
    expect(result.rules).toMatchObject({
      length: true, upper: true, lower: true, digit: true, symbol: true,
      notCommon: true, notPersonal: true,
    })
    expect(result.score).toBeGreaterThanOrEqual(3)
  })

  it('flags common passwords even if they meet all character classes', () => {
    const result = validatePassword('Password1234!')
    expect(result.rules.notCommon).toBe(false)
  })

  it('rejects when password contains the email local-part', () => {
    const result = validatePassword('CharlieMakesSense9!', { email: 'charlie@example.com' })
    expect(result.rules.notPersonal).toBe(false)
    expect(result.error).toMatch(/email or business name/)
  })

  it('rejects when password contains the business slug', () => {
    // Password "JoesPlumbingLtd99X!" slugifies to "joesplumbingltd99x" which
    // contains the full biz slug "joesplumbingltd". The rule fires.
    const result = validatePassword('JoesPlumbingLtd99X!', { businessName: 'Joes Plumbing Ltd' })
    expect(result.rules.notPersonal).toBe(false)
  })

  it('does not flag passwords that only share a single word with the business name', () => {
    // "Plumbing" alone shouldn't be enough — only the full slug is checked.
    const result = validatePassword('PlumbingPro99X!', { businessName: 'Joes Plumbing Ltd' })
    expect(result.rules.notPersonal).toBe(true)
  })

  it('does not falsely flag short email locals', () => {
    // Local-part "ab" is < 4 chars — must NOT disqualify everything that
    // contains "ab".
    const result = validatePassword('AbsoluteUnit99X!', { email: 'ab@x.com' })
    expect(result.rules.notPersonal).toBe(true)
  })

  it('rejects passwords missing required character classes', () => {
    expect(validatePassword('alllowercase1234!').rules.upper).toBe(false)
    expect(validatePassword('ALLUPPERCASE1234!').rules.lower).toBe(false)
    expect(validatePassword('NoDigitsHereOk!').rules.digit).toBe(false)
    expect(validatePassword('NoSymbolHere1234').rules.symbol).toBe(false)
  })

  it('caps maximum length to defend against bcrypt DoS', () => {
    const huge = 'A1!' + 'x'.repeat(PASSWORD_MAX_LENGTH)
    const result = validatePassword(huge)
    expect(result.error).toMatch(/at most/)
  })

  it('boosts long passphrases to "Strong" even with mixed classes', () => {
    const result = validatePassword('correct horse battery staple seven 7!')
    expect(result.score).toBeGreaterThanOrEqual(3)
  })

  it('returns sensible defaults for empty input', () => {
    const result = validatePassword('')
    expect(result.error).not.toBeNull()
    expect(result.rules.length).toBe(false)
  })

  it('exports min/max constants matching the validation rules', () => {
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(10)
    expect(PASSWORD_MAX_LENGTH).toBeLessThanOrEqual(256)
  })
})
