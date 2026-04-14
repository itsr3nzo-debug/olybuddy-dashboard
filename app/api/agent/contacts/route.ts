import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'

/** GET — list contacts, PATCH — update a contact */
export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
  const stage = url.searchParams.get('stage')
  const search = url.searchParams.get('search')

  let query = supabase
    .from('contacts')
    .select('*')
    .eq('client_id', clientId)
    .order('last_contacted', { ascending: false })
    .limit(limit)

  if (stage) query = query.eq('pipeline_stage', stage)
  if (search) {
    // Sanitize search to prevent PostgREST operator injection
    const safe = search.replace(/[%_(),.]/g, '').slice(0, 50)
    if (safe.length >= 2) {
      query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,phone.ilike.%${safe}%,company.ilike.%${safe}%`)
    }
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ contacts: data ?? [] })
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { contact_id, ...updates } = body

  if (!contact_id) {
    return NextResponse.json({ error: 'contact_id required' }, { status: 400 })
  }

  const auth = await authenticateAgentRequest(request, body.client_id as string | undefined)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth

  // Only allow updating safe fields
  const allowed = ['pipeline_stage', 'tags', 'assigned_to', 'first_name', 'last_name', 'email', 'phone', 'company']
  const safeUpdates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) safeUpdates[key] = updates[key]
  }

  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('contacts')
    .update(safeUpdates)
    .eq('id', contact_id)
    .eq('client_id', clientId)
    .select('id, pipeline_stage')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log activity if pipeline stage changed
  if (safeUpdates.pipeline_stage) {
    const { error: activityErr } = await supabase.from('activities').insert({
      client_id: clientId,
      contact_id,
      activity_type: 'stage_change',
      description: `Pipeline stage updated to ${safeUpdates.pipeline_stage} (via agent API)`,
      metadata: { source: 'agent_api', updates: safeUpdates },
    })
    if (activityErr) console.error('Activity log failed (non-fatal):', activityErr.message)
  }

  return NextResponse.json({ success: true, contact: data })
}
