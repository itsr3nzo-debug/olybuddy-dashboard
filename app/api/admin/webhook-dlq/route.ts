/**
 * GET /api/admin/webhook-dlq
 *
 * Super-admin-only view of the webhook dead-letter queue. Until this existed,
 * `webhook_dlq` had RLS `USING (false)` and was unreadable by anyone — Kade
 * had to run raw SQL to see failed webhook deliveries (Stripe account_id not
 * enriched yet, Calendar channel_id not registered, etc).
 *
 * Uses service role to bypass RLS after verifying the caller is super_admin.
 * Service role NEVER leaves the server.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  // Verify logged-in + super_admin role
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {},
      },
    },
  )
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })

  const role = user.app_metadata?.role ?? 'member'
  if (role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin only' }, { status: 403 })
  }

  // Service role bypasses RLS to read the DLQ
  const svc = createServiceClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const url = new URL(req.url)
  const provider = url.searchParams.get('provider')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500)

  let q = svc
    .from('webhook_dlq')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(limit)
  if (provider) q = q.eq('provider', provider)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'query failed', detail: error.message }, { status: 500 })

  return NextResponse.json({ count: data?.length ?? 0, entries: data ?? [] })
}
