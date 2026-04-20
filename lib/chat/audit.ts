import { createClient as createServiceClient } from '@supabase/supabase-js';

export type AdminAuditAction =
  | 'admin_view_start'
  | 'admin_view_end'
  | 'admin_chat_as_start'
  | 'admin_chat_message_sent'
  | 'admin_shadow_open'
  | 'admin_shadow_close';

/**
 * Record an admin action to the audit log via service-role (bypasses RLS).
 * Safe to call from server routes; silent on failure (never block the request).
 */
export async function auditAdmin(
  admin: { id: string; email: string },
  action: AdminAuditAction,
  details: {
    clientId?: string | null;
    targetKind?: string;
    targetId?: string;
    context?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    const service = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    await service.from('admin_audit_log').insert({
      admin_user_id: admin.id,
      admin_email: admin.email,
      client_id: details.clientId ?? null,
      action,
      target_kind: details.targetKind ?? null,
      target_id: details.targetId ?? null,
      context: details.context ?? null,
    });
  } catch {
    /* silent — never block the request */
  }
}
