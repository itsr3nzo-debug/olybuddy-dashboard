/**
 * Generic HMAC-SHA256 webhook signature verification.
 *
 * Used by /api/webhook/instantly. Stripe webhooks use the SDK's
 * `stripe.webhooks.constructEvent()` which has its own implementation;
 * we don't try to re-implement Stripe's scheme here.
 *
 * Pulled out to lib/ so tests can exercise the EXACT function the
 * production route imports — previous attempt put a copy of the
 * verifier inside the test file, which provided false confidence.
 */
import crypto from 'crypto'

/**
 * HMAC-SHA256 verification with constant-time comparison.
 *
 * Returns true iff `signature` is the lowercase-hex HMAC-SHA256 of `body`
 * keyed by `secret`. Returns false for any of:
 *   - missing/empty inputs
 *   - signature length mismatches the expected digest length
 *   - timingSafeEqual returns false
 *   - any internal exception (defensive)
 */
export function verifyHmacSha256Hex(
  body: string,
  signature: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || !signature || !body) return false
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  // Length-check before timingSafeEqual — that function throws on mismatched
  // buffer lengths and we want false, not an exception.
  if (expected.length !== signature.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}
