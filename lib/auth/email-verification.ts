/**
 * Email verification — generates a signed-token verification link, stores
 * the SHA-256 hash of the token in clients.email_verification_token_hash,
 * and emails the raw token to the user.
 *
 * Why not use Supabase's built-in confirmation? The seamless Stripe-checkout
 * flow needs the user signed in BEFORE Stripe redirects, so the signup route
 * sets `email_confirm: true` on the auth user. That bypasses Supabase's
 * built-in email-confirmation step (which would otherwise block sign-in).
 * We add this layer back in — same security guarantee, separate column —
 * so we can still gate things like "change email" and "cancel subscription"
 * on actual ownership of the email address.
 *
 * Tokens are 32 random bytes hex-encoded (256 bits of entropy) and expire
 * after 24h. Hash-at-rest pattern means a DB leak doesn't grant attackers
 * the ability to verify accounts they don't own.
 */
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendSystemEmail } from '@/lib/email'
import { buildVerifyEmailMessage } from '@/lib/email-templates/verify-email'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexley.vercel.app'

export const VERIFICATION_TTL_HOURS = 24

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Generate a fresh verification token for a client, store its hash, and
 * email the raw token to them as a click-link. Idempotent — re-calling
 * just supersedes the previous unused token (good for resend flows).
 *
 * Best-effort: any failure is logged + swallowed. A failed verification
 * email doesn't block signup — the user can request a resend from the
 * dashboard banner.
 */
export async function sendVerificationEmail(opts: {
  clientId: string
  email: string
  businessName?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const { clientId, email, businessName } = opts

  if (!email || !clientId) {
    return { ok: false, error: 'Missing client_id or email' }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const token = generateToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000)

    // Persist hash. Note: this overwrites any previous hash, so the old link
    // becomes invalid the moment a fresh one is sent (intentional).
    const { error: dbErr } = await supabase
      .from('clients')
      .update({
        email_verification_token_hash: tokenHash,
        email_verification_expires_at: expiresAt.toISOString(),
        email_verification_sent_at: new Date().toISOString(),
      })
      .eq('id', clientId)

    if (dbErr) {
      console.error('[verify-email] failed to persist token hash:', dbErr.message)
      return { ok: false, error: dbErr.message }
    }

    const verifyUrl = `${SITE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&id=${clientId}`
    const { subject, html, text } = buildVerifyEmailMessage({
      businessName: businessName || 'your account',
      actionLink: verifyUrl,
      expiresInHours: VERIFICATION_TTL_HOURS,
    })

    const result = await sendSystemEmail({ to: email, subject, html, text })
    if (!result.success) {
      console.error('[verify-email] SMTP send failed:', result.error)
      return { ok: false, error: result.error }
    }
    return { ok: true }
  } catch (e) {
    console.error('[verify-email] unexpected error:', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

/**
 * Validate a raw token against the stored hash for the given client. On
 * success: marks email_verified_at, clears the token hash, returns ok=true.
 * Constant-time hash comparison via timingSafeEqual prevents timing attacks
 * from leaking whether a guessed prefix is partially correct.
 */
export async function verifyEmailToken(opts: {
  clientId: string
  rawToken: string
}): Promise<{ ok: boolean; error?: string; alreadyVerified?: boolean }> {
  const { clientId, rawToken } = opts
  if (!clientId || !rawToken) {
    return { ok: false, error: 'Missing token or client_id' }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: client } = await supabase
    .from('clients')
    .select('id, email_verified_at, email_verification_token_hash, email_verification_expires_at')
    .eq('id', clientId)
    .single()

  if (!client) return { ok: false, error: 'Account not found' }
  if (client.email_verified_at) return { ok: true, alreadyVerified: true }

  if (!client.email_verification_token_hash) {
    return { ok: false, error: 'No pending verification — request a new link' }
  }
  if (client.email_verification_expires_at && new Date(client.email_verification_expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'This verification link has expired — request a new one' }
  }

  const incomingHash = hashToken(rawToken)
  const stored = client.email_verification_token_hash
  // Constant-time compare. timingSafeEqual throws if buffers differ in length.
  let match = false
  try {
    match = (incomingHash.length === stored.length)
      && crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(stored))
  } catch {
    match = false
  }
  if (!match) return { ok: false, error: 'Invalid verification link' }

  await supabase
    .from('clients')
    .update({
      email_verified_at: new Date().toISOString(),
      email_verification_token_hash: null,
      email_verification_expires_at: null,
    })
    .eq('id', clientId)

  return { ok: true }
}
