import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserSession } from '@/lib/rbac'
import { getSupabase } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = getUserSession(user)
    if (!session.clientId) {
      return NextResponse.json({ error: 'No client associated' }, { status: 400 })
    }

    const adminDb = getSupabase()

    const { data: client } = await adminDb
      .from('clients')
      .select('id, name, email, phone, onboarding_completed, onboarding_step, services_text, contact_name')
      .eq('id', session.clientId)
      .single()

    const { data: config } = await adminDb
      .from('agent_config')
      .select('greeting_message')
      .eq('client_id', session.clientId)
      .single()

    return NextResponse.json({
      name: client?.name ?? '',
      contact_name: client?.contact_name ?? '',
      phone: client?.phone ?? '',
      services_text: client?.services_text ?? '',
      greeting_message: config?.greeting_message ?? '',
      onboarding_completed: client?.onboarding_completed ?? false,
      onboarding_step: client?.onboarding_step ?? 1,
    })
  } catch (e) {
    console.error('GET /api/onboarding error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = getUserSession(user)
    if (!session.clientId) {
      return NextResponse.json({ error: 'No client associated' }, { status: 400 })
    }

    const { step, data } = await request.json()
    const adminDb = getSupabase()
    const clientId = session.clientId

    switch (step) {
      case 1: {
        // Update client business details
        const { name, contact_name, phone, services_text } = data
        await adminDb
          .from('clients')
          .update({ name, contact_name, phone, services_text, onboarding_step: 2 })
          .eq('id', clientId)

        if (name) {
          await adminDb
            .from('agent_config')
            .update({ business_name: name })
            .eq('client_id', clientId)
        }
        break
      }

      case 2: {
        // Integrations — just advance step
        await adminDb
          .from('clients')
          .update({ onboarding_step: 3 })
          .eq('id', clientId)
        break
      }

      case 3: {
        // Save greeting and mark onboarding complete
        const { greeting_message } = data
        if (greeting_message) {
          await adminDb
            .from('agent_config')
            .update({ greeting_message })
            .eq('client_id', clientId)
        }

        await adminDb
          .from('clients')
          .update({ onboarding_completed: true, onboarding_step: 3 })
          .eq('id', clientId)
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('PATCH /api/onboarding error:', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
