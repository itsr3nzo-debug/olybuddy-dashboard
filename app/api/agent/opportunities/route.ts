import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'

export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth
  const url = new URL(request.url)
  const stage = url.searchParams.get('stage')

  let query = supabase
    .from('opportunities')
    .select('*, contacts(first_name, last_name, phone, company)')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(100)

  if (stage) query = query.eq('stage', stage)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ opportunities: data ?? [] })
}

export async function POST(request: Request) {
  const body = await request.json()
  const auth = await authenticateAgentRequest(request, body.client_id)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth
  const { title, contact_id, stage = 'new', value_pence = 0 } = body

  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      client_id: clientId,
      contact_id: contact_id ?? null,
      title,
      stage,
      value_pence,
      assigned_to: 'agent',
      metadata: { source: 'agent_api' },
    })
    .select('id, title, stage')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, opportunity: data })
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const { opportunity_id, ...updates } = body

  if (!opportunity_id) {
    return NextResponse.json({ error: 'opportunity_id required' }, { status: 400 })
  }

  const auth = await authenticateAgentRequest(request, body.client_id)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth

  const allowed = ['stage', 'value_pence', 'title', 'probability', 'expected_close', 'assigned_to', 'lost_reason']
  const safeUpdates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) safeUpdates[key] = updates[key]
  }

  const { data, error } = await supabase
    .from('opportunities')
    .update(safeUpdates)
    .eq('id', opportunity_id)
    .eq('client_id', clientId)
    .select('id, stage, value_pence')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, opportunity: data })
}
