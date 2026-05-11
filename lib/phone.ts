/**
 * Shared phone number normalisation.
 *
 * Accepts international numbers (E.164) — UK, Ireland, India, anywhere a
 * customer can run WhatsApp. Returns a canonical `+<country><number>` string
 * if the input parses to a plausible E.164 number, or `null` if not.
 *
 * Input rules (case + whitespace insensitive, common separators stripped):
 *   - "+44 7700 900111"       → "+447700900111"  (E.164 explicit)
 *   - "+353 87 123 4567"      → "+353871234567"  (Ireland)
 *   - "+91 98765 43210"       → "+919876543210"  (India)
 *   - "00447700900111"        → "+447700900111"  (00 IDD prefix)
 *   - "0044 7700 900111"      → "+447700900111"  (00 IDD prefix, UK)
 *   - "07700 900111"          → "+447700900111"  (UK domestic — legacy, backward compat)
 *   - "447700900111"          → "+447700900111"  (E.164 minus the +)
 *   - "353871234567"          → "+353871234567"  (E.164 minus the +)
 *   - any other / too short   → null
 *
 * Output: `+<digits>` where total digits are 7-15 per ITU E.164. No
 * formatting, no spaces. Suitable for storage and WhatsApp / SMS delivery.
 */

// E.164 final form: `+` followed by country code (1-9 first digit, no
// leading 0) and 6-14 more digits. Total 7-15 digits after `+`.
const E164_RE = /^\+[1-9]\d{6,14}$/

export function normalizePhone(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null

  // Strip everything that isn't a digit or leading +
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]/g, '')

  if (cleaned.startsWith('+')) {
    // Already E.164 — keep as is
  } else if (cleaned.startsWith('00')) {
    // 00 IDD prefix → convert to +
    cleaned = '+' + cleaned.slice(2)
  } else if (cleaned.startsWith('0')) {
    // Leading 0 = UK domestic mobile (`07xxx`) — backward compat with the
    // pre-international form. Strip the 0, prefix +44.
    cleaned = '+44' + cleaned.slice(1)
  } else {
    // No prefix — assume the customer pasted their E.164 minus the +
    // (common for India, Ireland, raw exports from CRMs, etc.). Prefix +.
    cleaned = '+' + cleaned
  }

  if (!E164_RE.test(cleaned)) return null
  return cleaned
}

/**
 * Storage form for some endpoints (signup, sender-roles) — same canonical
 * number but without the leading `+`. Returns null on invalid input.
 */
export function normalizePhoneDigits(raw: string): string | null {
  const e164 = normalizePhone(raw)
  return e164 ? e164.slice(1) : null
}
