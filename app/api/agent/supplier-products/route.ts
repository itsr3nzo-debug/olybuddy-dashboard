/**
 * GET  /api/agent/supplier-products?q=...  — check cache
 * POST /api/agent/supplier-products         — persist research results
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

async function resolveClient(req: NextRequest): Promise<string | null> {
  // Accept both Authorization: Bearer oak_... and x-api-key: oak_... (see api-auth.ts).
  const bearer = (req.headers.get('authorization') || '').match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  const xkey = (req.headers.get('x-api-key') || '').match(/^(oak_[a-f0-9]+)$/i)
  const m = bearer ?? xkey
  if (!m) return null
  const supabase = service()
  const { data } = await supabase
    .from('agent_config').select('client_id').eq('agent_api_key', m[1]).maybeSingle()
  return data?.client_id ?? null
}

export async function GET(req: NextRequest) {
  const clientId = await resolveClient(req)
  if (!clientId) return NextResponse.json({ error: 'Missing or invalid agent bearer' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q') || ''
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })

  const supabase = service()
  // Simple substring match on cached queries, newest first, non-expired only
  const { data, error } = await supabase
    .from('supplier_products')
    .select('*')
    .eq('client_id', clientId)
    .gt('expires_at', new Date().toISOString())
    .ilike('query', `%${q}%`)
    .order('researched_at', { ascending: false })
    .limit(3)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cached: data ?? [] })
}

export async function POST(req: NextRequest) {
  const clientId = await resolveClient(req)
  if (!clientId) return NextResponse.json({ error: 'Missing or invalid agent bearer' }, { status: 401 })

  let body: {
    query: string
    matched_for_contact_phone?: string
    matched_for_job_external_id?: string
    results: unknown[]
    meta?: Record<string, unknown>
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.query || !Array.isArray(body.results)) {
    return NextResponse.json({ error: 'query + results[] required' }, { status: 400 })
  }

  const supabase = service()
  const { data, error } = await supabase.from('supplier_products').insert({
    client_id: clientId,
    query: body.query,
    matched_for_contact_phone: body.matched_for_contact_phone ?? null,
    matched_for_job_external_id: body.matched_for_job_external_id ?? null,
    results: body.results,
    meta: body.meta ?? {},
  }).select('id, researched_at, expires_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, ...data })
}
