/**
 * GET /api/provisioning/status
 *
 * Returns the current provisioning state for the authed user's client so the
 * dashboard can show "Your AI Employee is being set up" / "Live" / "Needs
 * operator attention" without exposing the queue internals.
 *
 * Scoped to the authenticated user's client_id (from JWT app_metadata).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

async function getAuthedClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll() { /* read-only */ },
    },
  })
  const { data: { user } } = await supabase.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) || null
}

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET() {
  const clientId = await getAuthedClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = service()

  // Client VPS state
  const { data: clientRow } = await supabase
    .from('clients')
    .select('vps_ip, vps_ready, vps_ready_at, vps_status, subscription_status')
    .eq('id', clientId)
    .maybeSingle()

  // Most recent provisioning row
  const { data: recent } = await supabase
    .from('provisioning_queue')
    .select('id, action, status, requested_at, started_at, completed_at, failed_at, error, attempts')
    .eq('client_id', clientId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Any still-pending or running rows
  const { count: pendingCount } = await supabase
    .from('provisioning_queue')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .in('status', ['pending', 'running'])

  // Derive a display-level state
  let state:
    | 'awaiting_vps'      // signed up, VPS not ready yet
    | 'provisioning'      // VPS ready, worker processing
    | 'live'              // everything completed
    | 'attention'         // recent failure
    | 'unknown' = 'unknown'
  let message = ''

  if (!clientRow) {
    state = 'unknown'
    message = 'Client record not found.'
  } else if (!clientRow.vps_ready) {
    state = 'awaiting_vps'
    message = 'Your AI Employee is being set up on its own private server. This usually takes a few hours — we\'ll email you the moment it\'s live.'
  } else if (recent?.status === 'failed') {
    state = 'attention'
    message = 'Something needs a quick fix — our team has been notified.'
  } else if (pendingCount && pendingCount > 0) {
    state = 'provisioning'
    message = 'Applying your latest settings to your AI Employee — this usually takes under a minute.'
  } else {
    state = 'live'
    message = 'Your AI Employee is live and ready to handle messages.'
  }

  return NextResponse.json({
    state,
    message,
    vps_ready: !!clientRow?.vps_ready,
    vps_ready_at: clientRow?.vps_ready_at ?? null,
    last_provisioning: recent ?? null,
    pending_count: pendingCount ?? 0,
  })
}
