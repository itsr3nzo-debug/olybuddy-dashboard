import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createClient as createServiceSupabase } from '@supabase/supabase-js'
import { sendVerificationEmail } from '@/lib/auth/email-verification'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * POST /api/auth/resend-verification
 *
 * Re-sends the verification email for the currently signed-in user. Rate
 * limited to 3/hr per client_id (rate_limit_events) so a hijacked session
 * can't mailbomb the legitimate owner. Returns ok=true even if the user is
 * already verified (idempotent — UI updates from the clients row).
 */
const RATE_LIMIT = 3
const RATE_WINDOW_MINUTES = 60

export async function POST(req: NextRequest) {
  // Auth — must be a logged-in user.
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const clientId = user.app_metadata?.client_id as string | undefined
  if (!clientId) {
    return NextResponse.json({ error: 'Account not linked to a client' }, { status: 400 })
  }

  // Service-role client for the rate-limit + clients lookups (bypasses RLS).
  const service = createServiceSupabase(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await service
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', `verify-resend:${clientId}`)
    .gte('created_at', windowStart)
  if ((count ?? 0) >= RATE_LIMIT) {
    return NextResponse.json(
      { error: 'You\u2019ve requested too many verification emails. Please wait an hour and try again.' },
      { status: 429 }
    )
  }
  await service.from('rate_limit_events').insert({ key: `verify-resend:${clientId}` })

  const { data: client } = await service
    .from('clients')
    .select('id, email, name, email_verified_at')
    .eq('id', clientId)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  if (client.email_verified_at) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  const result = await sendVerificationEmail({
    clientId: client.id,
    email: client.email,
    businessName: client.name,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Failed to send verification email' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** GET → ping endpoint for the dashboard banner to check current state. */
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ verified: false }, { status: 401 })

  const clientId = user.app_metadata?.client_id as string | undefined
  if (!clientId) return NextResponse.json({ verified: false }, { status: 400 })

  const service = createServiceSupabase(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: client } = await service
    .from('clients')
    .select('email_verified_at, email, email_verification_sent_at')
    .eq('id', clientId)
    .single()

  return NextResponse.json({
    verified: !!client?.email_verified_at,
    email: client?.email,
    lastSentAt: client?.email_verification_sent_at,
  })
}
