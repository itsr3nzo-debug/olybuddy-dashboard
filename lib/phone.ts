/**
 * Shared phone number normalisation.
 *
 * Accepts international numbers (E.164) — UK, Ireland, India, anywhere a
 * customer can run WhatsApp. Returns a canonical `+<country><number>` string
 * if the input parses to a plausible E.164 number, or `null` if not.
 *
 * Accepted inputs (case + whitespace insensitive, common separators stripped):
 *   - "+44 7700 900111"       → "+447700900111"  (E.164 explicit — best)
 *   - "+353 87 123 4567"      → "+353871234567"  (Ireland)
 *   - "+91 98765 43210"       → "+919876543210"  (India)
 *   - "00447700900111"        → "+447700900111"  (00 IDD prefix)
 *   - "00353871234567"        → "+353871234567"  (00 IDD prefix, Ireland)
 *   - "07700 900111"          → "+447700900111"  (UK domestic 11-digit 07xxx — backward compat)
 *   - "447700900111"          → "+447700900111"  (UK E.164 minus the + — backward compat)
 *
 * REJECTED (returns null — customer must include + or 00 prefix):
 *   - "087 1234567"           → null  (Irish domestic; would have been silently mis-routed to +44)
 *   - "0412 345 678"          → null  (Australian domestic, same risk)
 *   - "353871234567"          → null  (Irish no-prefix — ambiguous; could be misread)
 *   - "9876543210"            → null  (Indian no-prefix — ambiguous)
 *   - any 0-prefixed non-UK   → null  (DA-flagged: leading 0 is country-specific, never assume UK)
 *
 * The rejection is deliberate: silently routing an Irish "087 1234567" to
 * "+44 87 1234567" (a UK landline range that doesn't exist as a mobile)
 * would lock the customer out of WhatsApp signup with no diagnostic. Better
 * to reject and force them to add their + prefix.
 *
 * Output: `+<digits>` where total digits are 7-15 per ITU E.164. No
 * formatting, no spaces. Suitable for storage + WhatsApp / SMS delivery.
 */

// E.164 final form: `+` followed by country code (1-9 first digit, no
// leading 0) and 6-14 more digits. Total 7-15 digits after `+`.
const E164_RE = /^\+[1-9]\d{6,14}$/

// UK domestic mobile: exactly 11 digits, starts with "07" — the only
// no-country-code form we accept, for backward compat with existing UK
// customers who type "07700 900111" naturally.
const UK_DOMESTIC_07_RE = /^07\d{9}$/

// UK E.164 without the + (e.g. "447700900111") — accept this specific
// pattern for back-compat with apps that strip the leading +. Other no-+
// E.164 forms (353…, 91…) are NOT accepted to avoid ambiguity: a string
// like "353871234567" could be an Irish number or a UK number with an
// unusual prefix; we can't tell. Force + for everything that isn't UK.
const UK_E164_NO_PLUS_RE = /^447\d{9}$/

export function normalizePhone(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null

  // Strip whitespace, dashes, parens, dots. Keep digits and `+`.
  let cleaned = raw.trim().replace(/[\s\-\(\)\. ]/g, '')

  if (cleaned.startsWith('+')) {
    // Already E.164 — accept as-is, validate below
  } else if (cleaned.startsWith('00')) {
    // 00 IDD prefix → convert to + (works for any country)
    cleaned = '+' + cleaned.slice(2)
  } else if (UK_DOMESTIC_07_RE.test(cleaned)) {
    // UK domestic mobile — 11 digits starting with 07. Specific pattern only.
    cleaned = '+44' + cleaned.slice(1)
  } else if (UK_E164_NO_PLUS_RE.test(cleaned)) {
    // UK E.164 without + (e.g. "447700900111") — back-compat for legacy data
    cleaned = '+' + cleaned
  } else {
    // Any other input: leading 0 (Irish 087, Aussie 04xx, French 06xx,
    // German 01xx, etc.) OR no-prefix all-digits (could be any country) —
    // we can't safely guess the country code. Reject and force the user
    // to include their + prefix. The error message in the consumer code
    // tells them how.
    return null
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
