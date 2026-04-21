/**
 * PATCH /api/agent/integration-signals/:signal_id
 *
 * Owner-facing (dashboard): approve or reject a pending signal.
 * Also callable by the VPS agent to mark a signal auto-acted or failed.
 *
 * Authenticates via EITHER:
 *   - Dashboard cookie (owner clicking Approve in the UI)
 *   - VPS agent key (agent marking a signal as acted/failed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { authenticateAgent } from '@/lib/agent-auth'
import { z } from 'zod'

const PatchBody = z.object({
  status: z.enum(['owner_approved', 'owner_rejected', 'auto_acted', 'auto_skipped', 'expired', 'failed']),
  owner_note: z.string().max(500).optional(),
  action_result: z.record(z.string(), z.unknown()).optional(),
  // Optimistic-lock — only transition if current status matches. Prevents
  // parallel orchestrator runs from both acting on the same owner_approved
  // signal (e.g. two PDF extractions creating two Xero bills). If another
  // process already moved the signal away from `require_current_status`,
  // this PATCH returns 409 "already transitioned" — caller knows to skip.
  require_current_status: z
    .enum(['new', 'owner_approved', 'owner_rejected', 'auto_acted', 'auto_skipped', 'expired', 'failed'])
    .optional(),
})

function svc() {
  return createServiceClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ signal_id: string }> },
) {
  const { signal_id } = await params
  if (!signal_id || signal_id.length < 4) {
    return NextResponse.json({ error: 'bad signal_id' }, { status: 400 })
  }

  // Try agent auth first (VPS calling). If that fails, fall back to owner auth (dashboard).
  let clientId: string | null = null

  const agentAuth = await authenticateAgent(req)
  if (!(agentAuth instanceof NextResponse)) {
    clientId = agentAuth.clientId
  } else {
    // Try dashboard user-auth instead
    const sbAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: () => {},
        },
      },
    )
    const { data: { user } } = await sbAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
    }
    // RBAC: only owner + super_admin can approve/reject
    const role = user.app_metadata?.role ?? 'member'
    if (role !== 'owner' && role !== 'super_admin') {
      return NextResponse.json({ error: 'insufficient role' }, { status: 403 })
    }
    clientId = user.app_metadata?.client_id ?? null
    if (!clientId) {
      return NextResponse.json({ error: 'no client_id' }, { status: 400 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const parsed = PatchBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const sb = svc()
  const update: Record<string, unknown> = {
    status: parsed.data.status,
    acted_at_iso: new Date().toISOString(),
  }
  if (parsed.data.owner_note) update.owner_note = parsed.data.owner_note
  if (parsed.data.action_result) update.action_result_json = parsed.data.action_result

  let q = sb
    .from('integration_signals')
    .update(update)
    .eq('client_id', clientId)
    .eq('signal_id', signal_id)
  if (parsed.data.require_current_status) {
    q = q.eq('status', parsed.data.require_current_status)
  }
  const { data, error } = await q.select().maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'update failed', detail: error.message }, { status: 500 })
  }
  if (!data) {
    // Either signal doesn't exist for this client, or require_current_status
    // didn't match (another process transitioned it first).
    if (parsed.data.require_current_status) {
      // Check whether the row exists at all
      const { data: existing } = await sb
        .from('integration_signals')
        .select('status')
        .eq('client_id', clientId)
        .eq('signal_id', signal_id)
        .maybeSingle()
      if (existing) {
        return NextResponse.json(
          {
            error: 'already transitioned',
            detail: `Signal is now ${existing.status}; require_current_status=${parsed.data.require_current_status} didn't match.`,
            current_status: existing.status,
          },
          { status: 409 },
        )
      }
    }
    return NextResponse.json({ error: 'signal not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, signal: data })
}
