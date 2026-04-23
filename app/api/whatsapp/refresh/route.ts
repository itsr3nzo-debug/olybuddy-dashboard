/**
 * POST /api/whatsapp/refresh
 *
 * Owner-triggered WhatsApp auth reset. Sets agent_config.wa_refresh_requested_at
 * on the authed user's client row; the VPS-side wa-state-sync daemon notices
 * the new timestamp on its next tick and performs the wipe+restart, then the
 * plugin generates a fresh QR/code which flows back via the same syncer.
 *
 * No SSH from Vercel — everything goes through Supabase as the message bus.
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

async function getAuthedClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll() {
          /* read-only */
        },
      },
    },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) || null
}

export async function POST() {
  const clientId = await getAuthedClientId()
  if (!clientId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('agent_config')
    .update({ wa_refresh_requested_at: now })
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ requested_at: now })
}
