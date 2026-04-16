/**
 * GET  /api/pricing-rules — dashboard reads the authed user's rate card
 * PATCH /api/pricing-rules — upsert the rate card
 *
 * Agent-side lookup uses /api/agent/pricing-rules with an agent bearer instead.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getSession() {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return {
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

export async function GET() {
  const { clientId } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = service()
  const { data } = await supabase.from('pricing_rules').select('*').eq('client_id', clientId).maybeSingle()
  return NextResponse.json({ pricing_rules: data ?? null })
}

export async function PATCH(req: NextRequest) {
  const { clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can edit pricing' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const update: Record<string, unknown> = { client_id: clientId, updated_at: new Date().toISOString() }
  for (const k of ['labour_hourly_gbp', 'minimum_call_out_gbp', 'markup_tiers', 'loading_rules', 'item_rates', 'notes']) {
    if (k in body) update[k] = body[k]
  }

  const supabase = service()
  const { data, error } = await supabase
    .from('pricing_rules')
    .upsert(update, { onConflict: 'client_id' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, pricing_rules: data })
}
