import { describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { hashAgentKey } from '@/lib/agent-auth'

describe('hashAgentKey', () => {
  it('produces SHA-256 hex of the input', () => {
    const key = 'oak_abcdef0123456789'
    const expected = crypto.createHash('sha256').update(key).digest('hex')
    expect(hashAgentKey(key)).toBe(expected)
  })

  it('is deterministic — same input produces same output', () => {
    const a = hashAgentKey('oak_x')
    const b = hashAgentKey('oak_x')
    expect(a).toBe(b)
  })

  it('different keys hash differently', () => {
    expect(hashAgentKey('oak_a')).not.toBe(hashAgentKey('oak_b'))
  })

  it('output length is 64 hex chars (256-bit)', () => {
    expect(hashAgentKey('whatever').length).toBe(64)
    expect(/^[0-9a-f]{64}$/.test(hashAgentKey('whatever'))).toBe(true)
  })
})
