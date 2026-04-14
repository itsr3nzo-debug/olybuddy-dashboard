import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'

export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth
  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20') || 20, 1), 100)
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0') || 0, 0)
  const status = url.searchParams.get('status')
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '30') || 30, 1), 365)

  const since = new Date()
  since.setDate(since.getDate() - days)

  let query = supabase
    .from('call_logs')
    .select('*, contacts(first_name, last_name, phone, company)')
    .eq('client_id', clientId)
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ calls: data ?? [], count, limit, offset })
}
