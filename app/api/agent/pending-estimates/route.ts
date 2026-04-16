/**
 * GET /api/agent/pending-estimates
 *
 * The AI Employee polls this endpoint to find estimates uploaded via the
 * dashboard that it needs to process (vision pass + pricing). Returns the
 * awaiting_agent rows with a signed PDF URL the agent can fetch directly.
 *
 * The agent uses its own Claude Max subscription to do the vision — the
 * dashboard never calls Anthropic.
 *
 * POST: agent marks one as "being processed" (optimistic lock) to prevent
 * double-processing if multiple polls fire in the same window.
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
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  if (!m) return null
  const supabase = service()
  const { data } = await supabase
    .from('agent_config').select('client_id').eq('agent_api_key', m[1]).maybeSingle()
  return data?.client_id ?? null
}

export async function GET(req: NextRequest) {
  const clientId = await resolveClient(req)
  if (!clientId) return NextResponse.json({ error: 'Missing agent bearer' }, { status: 401 })

  const supabase = service()
  const { data, error } = await supabase
    .from('estimates')
    .select('id, title, created_at, source_pdf_url, meta')
    .eq('client_id', clientId)
    .eq('status', 'awaiting_agent')
    .order('created_at', { ascending: true })
    .limit(5)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-sign the PDFs so the agent has a fresh URL (originals expire).
  const withFreshUrls = await Promise.all(
    (data ?? []).map(async (row) => {
      const storagePath = (row.meta as { storage_path?: string } | null)?.storage_path
      if (!storagePath) return row
      const { data: signed } = await supabase.storage
        .from('estimates').createSignedUrl(storagePath, 60 * 60 * 2) // 2h signed URL
      return { ...row, source_pdf_url: signed?.signedUrl ?? row.source_pdf_url }
    })
  )

  return NextResponse.json({ pending: withFreshUrls, count: withFreshUrls.length })
}

/**
 * POST /api/agent/pending-estimates
 * Body: { id: "<estimate-uuid>" }
 * Atomically claims a row by bumping status from awaiting_agent → draft
 * (with meta.agent_claimed_at timestamp). Returns 200 on successful claim,
 * 409 if someone else already claimed it, 404 if missing.
 */
export async function POST(req: NextRequest) {
  const clientId = await resolveClient(req)
  if (!clientId) return NextResponse.json({ error: 'Missing agent bearer' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = service()
  const { data, error } = await supabase
    .from('estimates')
    .update({
      status: 'draft',
      meta: { agent_claimed_at: new Date().toISOString() },
    })
    .eq('id', id)
    .eq('client_id', clientId)
    .eq('status', 'awaiting_agent')
    .select('*')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Already claimed or not found' }, { status: 409 })

  return NextResponse.json({ success: true, estimate: data })
}
