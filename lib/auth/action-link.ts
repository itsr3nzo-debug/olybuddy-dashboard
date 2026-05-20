/**
 * Rebuild a Supabase admin-generated action_link to bypass Supabase's
 * server-side verify hop. The verify hop honours the project's redirect-URL
 * allowlist, which means a stale allowlist drops customers on a dead origin
 * (the exact bug fixed in /api/auth/request-reset). Extracting the token + type
 * and routing through our own callback page sidesteps the allowlist entirely.
 *
 * The callback page (`app/(auth)/auth/callback/page.tsx`) handles
 * `?token_hash=…&type=…` via supabase.auth.verifyOtp() client-side.
 *
 * @param actionLink   Supabase's `linkData.properties.action_link` — the URL
 *                     that normally would go in the email
 * @param ourCallback  Our callback URL — e.g. `${SITE_URL}/auth/callback`
 * @param defaultType  Fallback if `type` is absent from the action_link
 * @returns rebuilt URL pointing at our callback. If action_link is missing or
 *          malformed, returns `ourCallback` unchanged.
 */
export function rebuildSupabaseActionLink(
  actionLink: string | null | undefined,
  ourCallback: string,
  defaultType: 'magiclink' | 'recovery' | 'invite' | 'email' | 'signup' = 'magiclink',
): string {
  if (!actionLink) return ourCallback
  try {
    const u = new URL(actionLink)
    const token = u.searchParams.get('token')
    const type = u.searchParams.get('type') || defaultType
    if (token) {
      return `${ourCallback}?token_hash=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`
    }
  } catch {
    // malformed URL — fall through to fallback
  }
  return ourCallback
}
