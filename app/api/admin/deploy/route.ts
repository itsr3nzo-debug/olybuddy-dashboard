import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserSession } from '@/lib/rbac'
import { getSupabase } from '@/lib/supabase'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = getUserSession(user)
    if (session.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { client_id, vps_ip, vps_status_override } = await request.json()
    if (!client_id) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
    }

    const adminDb = getSupabase()

    // Verify the client exists
    const { data: client, error: clientErr } = await adminDb
      .from('clients')
      .select('id, name, vps_status')
      .eq('id', client_id)
      .single()

    if (clientErr || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // If a status override is provided (e.g. "live"), use that directly
    const newStatus = vps_status_override ?? 'provisioning'
    const updateData: Record<string, unknown> = { vps_status: newStatus }
    if (vps_ip) updateData.vps_ip = vps_ip

    await adminDb
      .from('clients')
      .update(updateData)
      .eq('id', client_id)

    const action = vps_status_override ? `Status set to ${newStatus}` : 'Deployment queued'
    console.log(`[Deploy] ${action} for client "${client.name}" (${client_id})${vps_ip ? ` — VPS IP: ${vps_ip}` : ''}`)

    return NextResponse.json({
      success: true,
      message: action,
      client_id,
    })
  } catch (e) {
    console.error('POST /api/admin/deploy error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
