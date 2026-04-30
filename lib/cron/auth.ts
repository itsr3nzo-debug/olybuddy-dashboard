/**
 * Cron auth helper. Vercel sends `Authorization: Bearer ${CRON_SECRET}` on
 * every cron-invoked Route Handler. We compare with constant-time equality
 * to avoid timing-attack windows on a shared secret.
 *
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 */

const CRON_SECRET = process.env.CRON_SECRET ?? ''

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function authorizeCron(request: Request): boolean {
  const auth = request.headers.get('authorization') ?? ''
  const presented = auth.replace(/^Bearer\s+/i, '').trim()
  if (!CRON_SECRET) {
    console.warn('[cron] CRON_SECRET not configured — refusing request')
    return false
  }
  return timingSafeEqual(presented, CRON_SECRET)
}
