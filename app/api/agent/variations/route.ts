/**
 * POST /api/agent/variations
 *
 * Agent skill `log-variation` posts scope-change rows here. Dashboard-side
 * the owner reviews/sends/marks approved.
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

export async function POST(req: NextRequest) {
  // Accept both Authorization: Bearer oak_... and x-api-key: oak_... so VPS
  // agents can use a single header style across every /api/agent/* endpoint.
  const bearer = (req.headers.get('authorization') || '').match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  const xkey = (req.headers.get('x-api-key') || '').match(/^(oak_[a-f0-9]+)$/i)
  const m = bearer ?? xkey
  if (!m) return NextResponse.json({ error: 'Missing agent key (Authorization: Bearer or x-api-key)' }, { status: 401 })

  const supabase = service()
  const { data: cfg } = await supabase
    .from('agent_config').select('client_id').eq('agent_api_key', m[1]).maybeSingle()
  if (!cfg?.client_id) return NextResponse.json({ error: 'Unknown agent key' }, { status: 401 })

  let body: {
    job_external_id?: string
    source_type?: string
    raw_transcript?: string
    description: string
    change_type?: string
    parts_added?: Array<{ item: string; qty: number }>
    labour_mins?: number
    price_gbp?: number
    meta?: Record<string, unknown>
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const { data, error } = await supabase.from('variations').insert({
    client_id: cfg.client_id,
    job_external_id: body.job_external_id ?? null,
    source_type: body.source_type ?? null,
    raw_transcript: body.raw_transcript ?? null,
    description: body.description,
    change_type: body.change_type ?? null,
    parts_added: body.parts_added ?? [],
    labour_mins: body.labour_mins ?? null,
    price_gbp: body.price_gbp ?? null,
    meta: body.meta ?? {},
  }).select('id, logged_at, status').single()

  if (error) return NextResponse.json({ error: 'Insert failed', detail: error.message }, { status: 500 })
  return NextResponse.json({ success: true, ...data })
}
