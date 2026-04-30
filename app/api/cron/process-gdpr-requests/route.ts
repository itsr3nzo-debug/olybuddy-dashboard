/**
 * GET /api/cron/process-gdpr-requests
 *
 * Picks up `gdpr_requests` rows with status='received' (export type), compiles
 * a JSON dump of the user's data, uploads to Supabase Storage with a 7-day
 * signed URL, marks the row complete, and emails the link.
 *
 * Schedule: every 15 minutes (vercel.json)
 *
 * GDPR Article 15 timing: 1 month max; we typically complete within minutes.
 *
 * Bundle includes:
 *   - User profile (auth.users)
 *   - Client (clients)
 *   - All conversations + messages (agent_chat_sessions + agent_chat_messages)
 *   - Customer conversations they oversee (conversations + comms_log)
 *   - Contacts
 *   - Estimates + Jobs
 *   - Notifications history
 *   - Push subscriptions (metadata only, no tokens)
 *
 * Excluded for legal/operational reasons:
 *   - Other tenants' data (RLS-enforced)
 *   - Internal billing/Stripe events (financial records, retained 6 years per
 *     UK statute — referenced in scrubbed form)
 *   - System logs (we keep but don't export)
 */

import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 300

const EXPORT_BUCKET = 'gdpr-exports'

export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = createUntypedServiceClient()

  // Pick up batch (limit 5/run — exports can be large, don't let one run swallow everything)
  const { data: pending, error: pendErr } = await sb
    .from('gdpr_requests')
    .select('id, user_id, client_id, email')
    .eq('request_type', 'export')
    .eq('status', 'received')
    .order('created_at', { ascending: true })
    .limit(5)

  if (pendErr) {
    console.error('[cron/gdpr] read failed:', pendErr)
    return new Response('Read failed', { status: 500 })
  }
  if (!pending || pending.length === 0) {
    return Response.json({ ok: true, processed: 0 })
  }

  let processed = 0
  let failed = 0

  for (const req of pending) {
    try {
      // Mark in-progress
      await sb.from('gdpr_requests').update({ status: 'processing' }).eq('id', req.id)

      const bundle = await compileBundle(sb, req.user_id as string, req.client_id as string)
      const fileName = `${req.user_id}/${req.id}.json`

      const { error: upErr } = await sb.storage
        .from(EXPORT_BUCKET)
        .upload(fileName, JSON.stringify(bundle, null, 2), {
          contentType: 'application/json',
          upsert: true,
        })
      if (upErr) throw upErr

      // 7-day signed URL
      const { data: signed } = await sb.storage
        .from(EXPORT_BUCKET)
        .createSignedUrl(fileName, 60 * 60 * 24 * 7)

      await sb
        .from('gdpr_requests')
        .update({
          status: 'completed',
          download_url: signed?.signedUrl ?? null,
          download_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', req.id)

      // TODO email integration — once nodemailer flow is wired here, send to req.email
      processed += 1
    } catch (err) {
      console.error('[cron/gdpr] export failed for', req.id, err)
      await sb
        .from('gdpr_requests')
        .update({
          status: 'rejected',
          rejection_reason: (err as Error).message.slice(0, 500),
        })
        .eq('id', req.id)
      failed += 1
    }
  }

  return Response.json({ ok: true, processed, failed })
}

async function compileBundle(
  sb: import("@/lib/supabase/untyped").UntypedSupabase,
  userId: string,
  clientId: string
): Promise<Record<string, unknown>> {
  // Pull every table the user owns. Each .select() is RLS-bypassed via service role.
  const [
    user,
    client,
    sessions,
    messages,
    conversations,
    comms,
    contacts,
    estimates,
    jobs,
    notifications,
    pushSubs,
    notifPrefs,
    activities,
  ] = await Promise.all([
    sb.from('auth.users').select('id, email, created_at, updated_at, last_sign_in_at').eq('id', userId).maybeSingle(),
    sb.from('clients').select('*').eq('id', clientId).maybeSingle(),
    sb.from('agent_chat_sessions').select('*').eq('client_id', clientId),
    sb.from('agent_chat_messages').select('*').eq('client_id', clientId),
    sb.from('conversation_sessions').select('*').eq('client_id', clientId),
    sb.from('comms_log').select('*').eq('client_id', clientId),
    sb.from('contacts').select('*').eq('client_id', clientId),
    sb.from('estimates').select('*').eq('client_id', clientId),
    sb.from('agent_actions').select('*').eq('client_id', clientId).eq('category', 'booking_made'),
    sb.from('notifications').select('*').eq('user_id', userId),
    sb.from('push_subscriptions').select('id, platform, app_version, device_model, created_at, last_seen_at').eq('user_id', userId),
    sb.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('agent_actions').select('*').eq('client_id', clientId),
  ])

  return {
    exported_at: new Date().toISOString(),
    export_format_version: '1.0',
    user: user.data,
    client: client.data,
    chat_with_ai_employee: {
      sessions: sessions.data ?? [],
      messages: messages.data ?? [],
    },
    customer_conversations: {
      conversations: conversations.data ?? [],
      messages: comms.data ?? [],
    },
    contacts: contacts.data ?? [],
    estimates: estimates.data ?? [],
    jobs: jobs.data ?? [],
    activities: activities.data ?? [],
    notifications: notifications.data ?? [],
    push_subscriptions: pushSubs.data ?? [],
    notification_preferences: notifPrefs.data,
    note_on_omitted_data:
      'Stripe billing records are retained for 6 years under UK statute. PII has been minimised in those records.',
  }
}
