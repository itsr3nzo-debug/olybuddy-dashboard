import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
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
      .select('id, name, email, phone, onboarding_completed, onboarding_step, services_text, contact_name, dpa_accepted_at')
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
      dpa_accepted_at: client?.dpa_accepted_at ?? null,
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
        // Integrations — just advance step (guard enforced client-side: ≥1 required)
        await adminDb
          .from('clients')
          .update({ onboarding_step: 3 })
          .eq('id', clientId)
        break
      }

      case 3: {
        // DPA click-to-sign — required for UK GDPR Article 28 compliance
        const dpaAcceptedAt = data?.dpa_accepted_at ?? new Date().toISOString()
        await adminDb
          .from('clients')
          .update({ dpa_accepted_at: dpaAcceptedAt, onboarding_step: 4 })
          .eq('id', clientId)
        break
      }

      case 4: {
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
          .update({ onboarding_completed: true, onboarding_step: 4 })
          .eq('id', clientId)

        // Also stamp onboarding_completed=true into the user's app_metadata so
        // the proxy (which runs on every authenticated request) can read it
        // straight from the JWT without a Supabase round-trip. Falls through to
        // a DB lookup only if this update hasn't propagated yet.
        try {
          await adminDb.auth.admin.updateUserById(user.id, {
            app_metadata: {
              ...user.app_metadata,
              onboarding_completed: true,
            },
          })
        } catch (e) {
          // Non-fatal. Proxy will still DB-fall-back. Just log.
          console.error('[onboarding] Failed to update app_metadata.onboarding_completed:', e)
        }

        // Invalidate every cached RSC under the dashboard layout so the next
        // client navigation sees onboarding_completed=true immediately.
        revalidatePath('/', 'layout')
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
