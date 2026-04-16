/**
 * GET /api/agent/pricing-rules — skill reads the rate card via agent bearer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  if (!m) return NextResponse.json({ error: 'Missing agent bearer' }, { status: 401 })

  const supabase = service()
  const { data: cfg } = await supabase
    .from('agent_config').select('client_id').eq('agent_api_key', m[1]).maybeSingle()
  if (!cfg?.client_id) return NextResponse.json({ error: 'Unknown agent key' }, { status: 401 })

  const { data } = await supabase
    .from('pricing_rules').select('*').eq('client_id', cfg.client_id).maybeSingle()

  return NextResponse.json({ pricing_rules: data ?? null })
}
