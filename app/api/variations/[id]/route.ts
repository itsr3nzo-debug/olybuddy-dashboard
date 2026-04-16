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

async function getClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) ?? null
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientId = await getClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const allowed: Record<string, unknown> = {}
  for (const k of ['status', 'description', 'price_gbp', 'labour_mins', 'change_type', 'parts_added']) {
    if (k in body) allowed[k] = body[k]
  }
  if (allowed.status === 'sent_to_client') allowed.sent_at = new Date().toISOString()
  if (allowed.status === 'approved') allowed.approved_at = new Date().toISOString()

  const supabase = service()
  const { data, error } = await supabase
    .from('variations')
    .update(allowed)
    .eq('id', id)
    .eq('client_id', clientId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, variation: data })
}
