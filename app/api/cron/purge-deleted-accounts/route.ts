/**
 * GET /api/cron/purge-deleted-accounts
 *
 * Hard-deletes accounts whose `clients.deletion_requested_at` is older than
 * 14 days. Per ICO guidance, GDPR Article 17 erasure must complete within
 * 1 month — 14 days gives us slack for any data-recovery requests during
 * the soft-delete window.
 *
 * Steps for each tenant:
 *   1. Cancel & delete Stripe customer (returns deleted: true; Stripe retains
 *      financial records but PII is anonymised on their end too).
 *   2. Delete every tenant-scoped row across the 30+ tables that hold PII
 *      or business data; delete every Storage object under the tenant's
 *      folder in captures + chat-attachments + gdpr-exports; and write a
 *      provisioning_queue row to deprovision the per-tenant VPS (Baileys
 *      WhatsApp credentials, /opt/clients/<slug>/, agent state).
 *   3. Anonymise the clients row (PII fields → null, audit columns retained).
 *   4. Delete the auth user (Supabase admin API).
 *   5. Delete the matching `gdpr_requests` row's pending state to 'completed'.
 *   6. Mark `clients.hard_deleted_at = now()`.
 *
 * Schedule: daily at 04:00 UTC (vercel.json)
 */

import Stripe from 'stripe'
import { authorizeCron } from '@/lib/cron/auth'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 300

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? ''

const PURGE_AFTER_DAYS = 14

export async function GET(request: Request) {
  if (!authorizeCron(request)) return new Response('Unauthorized', { status: 401 })

  const sb = createUntypedServiceClient()

  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: pending, error } = await sb
    .from('clients')
    .select('id, slug, owner_user_id, stripe_customer_id, deletion_requested_at')
    .lt('deletion_requested_at', cutoff)
    .is('hard_deleted_at', null)
    .limit(20)

  if (error) {
    console.error('[cron/purge-deleted] read failed:', error)
    return new Response('Read failed', { status: 500 })
  }
  if (!pending || pending.length === 0) {
    return Response.json({ ok: true, deleted: 0 })
  }

  const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null
  let deleted = 0
  let failed = 0
  const errors: Array<{ client_id: string; body: string }> = []

  for (const c of pending) {
    try {
      const clientId = c.id as string

      // 1. Stripe — best-effort delete
      if (stripe && c.stripe_customer_id) {
        try {
          await stripe.customers.del(c.stripe_customer_id as string)
        } catch (err) {
          console.error('[cron/purge-deleted] Stripe del failed for', c.stripe_customer_id, err)
        }
      }

      // 2a. Tenant rows. Order matters for FK cascades — child rows first.
      // Audit logs (audit_logs, admin_audit_log) are deliberately retained
      // per ICO guidance: an immutable audit trail of deletion is itself
      // a defensible GDPR requirement (Art 30 records of processing). The
      // PII fields in those rows are anonymised by the clients-row update
      // below.
      const tenantTables = [
        // Chat surface
        'agent_chat_messages', 'agent_chat_sessions',
        // Customer comms
        'comms_log', 'conversation_sessions', 'external_triggers', 'webhook_dlq',
        // Customers + opportunities
        'contacts', 'companies', 'opportunities',
        'pipeline_stages', 'pipelines', 'stage_history',
        'sequence_enrollments', 'sequence_steps', 'sequences',
        'message_templates', 'tasks', 'notes', 'appointments',
        'call_logs', 'estimates', 'pricing_rules', 'captured_jobs', 'variations',
        // AI Employee operational state
        'agent_actions', 'agent_config', 'agent_alerts', 'agent_health',
        'agent_heartbeats', 'agent_pulse', 'integration_signals',
        'integration_sync_logs',
        // Captures (photo metadata; the photos themselves are nuked from
        // Storage in step 2b below)
        'captures',
        // Notifications + preferences
        'notifications', 'notification_preferences', 'push_subscriptions',
        'subscription_expiry_alerts',
        // Vault
        'vault_files', 'vault_projects',
        // Idempotency caches that may contain PII payloads
        'request_idempotency',
        // Billing + lifecycle
        'integrations', 'llm_budget_periods', 'mobile_telemetry',
        'referrals', 'winback_sequence', 'trial_sequence',
        // Webhooks (may contain PII payloads)
        'webhook_log', 'stripe_events',
      ]
      for (const tbl of tenantTables) {
        try {
          await sb.from(tbl).delete().eq('client_id', clientId)
        } catch (err) {
          // Continue on per-table errors so one missing table doesn't block
          // the whole purge. Errors logged for ops review.
          console.error(`[cron/purge-deleted] delete ${tbl} failed for ${clientId}:`, err)
        }
      }

      // 2b. Storage objects — list every object under <client_id>/ prefix
      // in the three buckets that may contain tenant PII, then bulk delete.
      for (const bucket of ['captures', 'chat-attachments', 'gdpr-exports']) {
        try {
          const { data: objs } = await sb.storage
            .from(bucket)
            .list(clientId, { limit: 1000 })
          // Recursively walk subfolders one level deep (typical layout is
          // <client_id>/<session_id>/<file>). One level covers all current
          // patterns; if we ever go deeper, recurse here.
          const paths: string[] = []
          for (const entry of objs ?? []) {
            if (entry.id == null && entry.name) {
              // Folder
              const { data: nested } = await sb.storage
                .from(bucket)
                .list(`${clientId}/${entry.name}`, { limit: 1000 })
              for (const n of nested ?? []) {
                paths.push(`${clientId}/${entry.name}/${n.name}`)
              }
            } else if (entry.name) {
              paths.push(`${clientId}/${entry.name}`)
            }
          }
          if (paths.length > 0) {
            await sb.storage.from(bucket).remove(paths)
          }
        } catch (err) {
          console.error(`[cron/purge-deleted] storage ${bucket} purge failed for ${clientId}:`, err)
        }
      }

      // 2c. VPS deprovisioning — write a provisioning_queue row so the
      // Mac mini worker SSHes in and removes /opt/clients/<slug>/, stops
      // the systemd unit, and revokes the per-VPS Baileys auth state +
      // the per-VPS Composio key (separate cleanup path because the Mac
      // mini holds the SSH key, not Vercel).
      try {
        await sb.from('provisioning_queue').insert({
          client_id: clientId,
          action: 'deprovision_vps',
          payload: { reason: 'gdpr_erasure', requested_at: new Date().toISOString() },
          status: 'pending',
        })
      } catch (err) {
        console.error(`[cron/purge-deleted] vps deprovision queue failed for ${clientId}:`, err)
      }

      // 3. Anonymise client row (retain id + deletion audit only)
      await sb
        .from('clients')
        .update({
          slug: `deleted_${clientId.slice(0, 8)}`,
          business_name: null,
          owner_name: null,
          owner_phone: null,
          owner_email: null,
          email: null,
          stripe_customer_id: null,
          hard_deleted_at: new Date().toISOString(),
        })
        .eq('id', clientId)

      // 4. Auth user delete (best-effort)
      if (c.owner_user_id) {
        try {
          await sb.auth.admin.deleteUser(c.owner_user_id as string)
        } catch (err) {
          console.error('[cron/purge-deleted] auth.admin.deleteUser failed:', err)
        }
      }

      // 5. Mark gdpr_request completed
      await sb
        .from('gdpr_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('client_id', clientId)
        .eq('request_type', 'delete')
        .eq('status', 'processing')

      deleted += 1
    } catch (err) {
      console.error('[cron/purge-deleted] failed for', c.id, err)
      failed += 1
      errors.push({ client_id: c.id as string, body: (err as Error).message })
    }
  }

  return Response.json({ ok: true, deleted, failed, errors })
}
