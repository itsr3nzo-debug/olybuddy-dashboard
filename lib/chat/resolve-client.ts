import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Resolve which client_id an API request should act under.
 *
 * owner/member roles: always pinned to their `app_metadata.client_id`.
 * super_admin: may pass ?client=<uuid> (query param) or include in body.
 *   Without an explicit override, returns null — caller should 400.
 */
export function resolveClientId(
  user: User,
  explicitClientId?: string | null
): { clientId: string | null; isAdminOverride: boolean } {
  const role = (user.app_metadata?.role as string | undefined) ?? 'member';
  const ownClientId = (user.app_metadata?.client_id as string | undefined) ?? null;

  if (role === 'super_admin') {
    if (explicitClientId) return { clientId: explicitClientId, isAdminOverride: true };
    return { clientId: ownClientId, isAdminOverride: false };
  }
  // owner/member — always pinned
  return { clientId: ownClientId, isAdminOverride: false };
}

/**
 * For admin cross-tenant writes we need to use the service-role key so we
 * bypass the user's own JWT-bound RLS. Callers that hit this path MUST have
 * already verified the requester is super_admin.
 */
export function isSuperAdmin(user: User): boolean {
  return (user.app_metadata?.role as string | undefined) === 'super_admin';
}

/** Verify a session belongs to the client we're acting under. */
export async function sessionBelongsToClient(
  supabase: SupabaseClient,
  sessionId: string,
  clientId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('agent_chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('client_id', clientId)
    .maybeSingle();
  return !!data;
}
