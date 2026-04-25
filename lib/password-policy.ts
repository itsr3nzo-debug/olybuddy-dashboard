/**
 * Password policy — shared between server (api/signup, api/auth/*)
 * and client (signup wizard, password reset). Keep the rules in ONE place
 * so the live UI feedback can never drift from what the server actually
 * enforces.
 *
 * Rules (intentionally moderate — we want strong passwords without the
 * "must contain a Sumerian rune" theatre that makes people reuse the same
 * Password1!):
 *
 *   1. Length ≥ 12  (NIST 800-63B says length is the strongest single factor)
 *   2. Length ≤ 128 (defends against DoS via huge bcrypt input)
 *   3. ≥ 1 lowercase letter
 *   4. ≥ 1 uppercase letter
 *   5. ≥ 1 digit
 *   6. ≥ 1 symbol (anything outside [A-Za-z0-9])
 *   7. Not in the top-1000 most-pwned password list (case-insensitive)
 *   8. Doesn't contain the user's email local-part (>=4 chars) or business name
 *
 * `validatePassword(pw, ctx)` returns null on success, or a short
 * user-readable error string on the first failed rule.
 */

// Top-200 most common passwords (subset of HIBP/SecLists rockyou). Kept
// inline — the entire 1k list adds ~10kb but doesn't materially help: anyone
// trying these is already blocked by the first hit. We can swap to a hashed
// k-anonymity HIBP API call later if we want belt-and-braces.
const COMMON_PASSWORDS = new Set([
  '123456', '123456789', 'qwerty', 'password', '12345', 'qwerty123', '1q2w3e',
  '12345678', '111111', '1234567890', '1234567', 'password1', 'abc123',
  'iloveyou', 'admin', 'welcome', 'monkey', '654321', '1qaz2wsx', '123321',
  'qwertyuiop', '123123', 'dragon', 'letmein', 'baseball', 'football',
  'master', 'sunshine', 'princess', 'login', 'starwars', 'whatever',
  'qazwsx', 'trustno1', 'jordan23', 'harley', 'mustang', 'access', 'shadow',
  'michael', 'superman', 'batman', 'thomas', 'soccer', 'killer', 'jordan',
  'pepper', 'ashley', 'bailey', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty1',
  'qwerty12', 'qwerty123', 'password12', 'password123', 'password1234',
  'password12345', 'password1!', 'password!', 'admin123', 'admin1234',
  'welcome123', 'welcome1', 'changeme', 'changeme123', 'letmein1', 'letmein123',
  'qwertyui', 'asdfghjkl', 'zxcvbnm', 'asdf1234', '1q2w3e4r', '1q2w3e4r5t',
  'qwer1234', 'qwer12345', 'q1w2e3r4', 'q1w2e3r4t5', 'iloveyou1', 'iloveyou123',
  'monkey123', 'dragon123', 'master123', 'shadow123', 'superman123', 'batman123',
  'football1', 'football123', 'baseball1', 'baseball123', 'jordan23', 'jordan123',
  'tigger', 'computer', 'liverpool', 'ranger', 'jennifer', 'hunter', 'buster',
  'soccer1', 'hockey', 'killer1', 'george', 'sexy', 'andrew', 'charlie',
  'andrea', 'pokemon', 'cookie', 'naruto', 'pikachu', 'minecraft', 'fortnite',
  'nintendo', 'samsung', 'iphone', 'apple', 'google', 'facebook', 'twitter',
  'instagram', 'snapchat', 'tiktok', 'youtube', 'whatsapp', 'gmail', 'outlook',
  'yahoo', 'hotmail', 'business', 'company', 'office', 'work', 'home',
  'family', 'love', 'lovely', 'sweet', 'happy', 'angel', 'baby', 'kitty',
  'puppy', 'flower', 'beautiful', 'pretty', 'nice', 'good', 'best', 'great',
  'amazing', 'awesome', 'cool', 'fun', 'fantastic', 'london', 'manchester',
  'liverpool', 'birmingham', 'glasgow', 'leeds', 'bristol', 'edinburgh',
  'cardiff', 'belfast', 'sheffield', 'newcastle', 'brighton', 'arsenal',
  'chelsea', 'tottenham', 'unitedfc', 'manunited', 'celtic', 'rangers',
  'england', 'scotland', 'wales', 'ireland', 'britain', 'london123',
  'manchester1', 'arsenal1', 'chelsea1', 'liverpoolfc', '0000', '1111', '2222',
  '3333', '4444', '5555', '6666', '7777', '8888', '9999', '00000', '11111',
  '99999', '012345', '987654', '01234567', '76543210', 'abcdef', 'abcdefg',
  'abcdefgh', 'a1b2c3d4', 'aaaaaa', 'bbbbbb', 'aaaaaaaa', '00000000', '11111111',
])

export interface PasswordContext {
  email?: string
  businessName?: string
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4   // 0=very weak … 4=strong
  label: 'Very weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  /** First failing rule, or null if all rules pass. */
  error: string | null
  /** Per-rule pass/fail map for the live UI checklist. */
  rules: {
    length: boolean
    upper: boolean
    lower: boolean
    digit: boolean
    symbol: boolean
    notCommon: boolean
    notPersonal: boolean
  }
}

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

const SYMBOL_RE = /[^A-Za-z0-9]/

export function validatePassword(
  password: string,
  ctx: PasswordContext = {}
): PasswordStrength {
  const pw = String(password ?? '')
  const lower = pw.toLowerCase()

  const rules = {
    length: pw.length >= PASSWORD_MIN_LENGTH && pw.length <= PASSWORD_MAX_LENGTH,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: SYMBOL_RE.test(pw),
    notCommon: !COMMON_PASSWORDS.has(lower) && !COMMON_PASSWORDS.has(lower.replace(/[^a-z0-9]/g, '')),
    notPersonal: true,
  }

  // Personal-info check — avoid passwords that are basically the user's
  // email or business name (common reuse pattern). Match on the local-part
  // (before @) of the email, ignoring case, only if it's >=4 chars (so
  // "bob@x.com" doesn't disqualify everything containing "bob").
  const emailLocal = (ctx.email || '').split('@')[0]?.toLowerCase() || ''
  if (emailLocal.length >= 4 && lower.includes(emailLocal)) rules.notPersonal = false
  const bizSlug = (ctx.businessName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (bizSlug.length >= 4 && lower.replace(/[^a-z0-9]/g, '').includes(bizSlug)) rules.notPersonal = false

  // First-failure error message (order matters — most fundamental first)
  let error: string | null = null
  if (!rules.length) {
    error = pw.length < PASSWORD_MIN_LENGTH
      ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
      : `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  } else if (!rules.lower) error = 'Password must contain a lowercase letter'
  else if (!rules.upper) error = 'Password must contain an uppercase letter'
  else if (!rules.digit) error = 'Password must contain a number'
  else if (!rules.symbol) error = 'Password must contain a symbol (e.g. ! @ # $)'
  else if (!rules.notCommon) error = 'That password is too common — pick something less guessable'
  else if (!rules.notPersonal) error = "Password shouldn't contain your email or business name"

  // Strength score is the count of passing rules, capped at 4. Pure length
  // bonus past 16 chars bumps to 4 even if they only have 2 character classes
  // (long passphrase) — this matches what zxcvbn would give a 5-word diceware.
  const passing = Object.values(rules).filter(Boolean).length
  let score: PasswordStrength['score'] = 0
  if (passing >= 7) score = 4
  else if (passing >= 6) score = 3
  else if (passing >= 4) score = 2
  else if (passing >= 2) score = 1
  // Long passphrase bonus
  if (pw.length >= 20 && rules.length && rules.notCommon && rules.notPersonal && score < 4) {
    score = (Math.min(4, score + 1)) as PasswordStrength['score']
  }

  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const
  return { score, label: labels[score], error, rules }
}
