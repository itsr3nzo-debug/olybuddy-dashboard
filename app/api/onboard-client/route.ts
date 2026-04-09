import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { buildAgentPrompt, buildFirstMessage } from '@/lib/agent-prompt-builder'
import { updateAgent } from '@/lib/elevenlabs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const TEMPLATE_AGENT_ID = process.env.ELEVENLABS_TEMPLATE_AGENT_ID ?? 'agent_1401kncgtzv4e9ws3mp87w5f08fm'

export async function POST(request: NextRequest) {
  // Auth check
  const apiKey = request.headers.get('x-api-key')
  if (INTERNAL_API_KEY && apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      business_name,
      email,
      phone,
      industry = 'general',
      plan = 'starter',
    } = body

    if (!business_name || !email) {
      return NextResponse.json({ error: 'business_name and email are required' }, { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Step 1: Create client row
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        name: business_name,
        slug: business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        email,
        phone: phone ?? null,
        industry,
        subscription_status: 'trial',
        subscription_plan: plan,
      })
      .select('id')
      .single()

    if (clientErr) {
      return NextResponse.json({ error: `Client creation failed: ${clientErr.message}` }, { status: 500 })
    }

    const clientId = client.id

    // Step 2: Create agent_config with defaults
    const defaultHours = {
      mon: { open: '09:00', close: '17:00' },
      tue: { open: '09:00', close: '17:00' },
      wed: { open: '09:00', close: '17:00' },
      thu: { open: '09:00', close: '17:00' },
      fri: { open: '09:00', close: '17:00' },
      sat: 'closed',
      sun: 'closed',
    }

    const { error: configErr } = await supabase
      .from('agent_config')
      .insert({
        client_id: clientId,
        business_name,
        business_description: `${business_name} — ${industry} services`,
        agent_name: 'Ava',
        agent_status: 'online',
        is_active: true,
        tone: 'friendly',
        hours: defaultHours,
        services: [],
        faqs: [],
        greeting_message: `Hey, thanks for calling ${business_name}! My name is Ava. How can I help you today?`,
        agent_id: TEMPLATE_AGENT_ID, // Use shared agent for now; clone later
      })

    if (configErr) {
      // Rollback client
      await supabase.from('clients').delete().eq('id', clientId)
      return NextResponse.json({ error: `Config creation failed: ${configErr.message}` }, { status: 500 })
    }

    // Step 3: Create Supabase auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { client_id: clientId },
    })

    if (authErr) {
      console.error('Auth user creation failed (non-fatal):', authErr.message)
      // Don't rollback — client + config are still useful
    }

    // Step 4: Sync prompt to ElevenLabs (if using template agent)
    try {
      const { data: config } = await supabase
        .from('agent_config')
        .select('*')
        .eq('client_id', clientId)
        .single()

      if (config?.agent_id) {
        const prompt = buildAgentPrompt(config)
        const firstMessage = buildFirstMessage(config)
        await updateAgent(config.agent_id, prompt, firstMessage)
      }
    } catch (syncErr) {
      console.error('ElevenLabs sync on onboard failed (non-fatal):', syncErr)
    }

    // Step 5: Send magic link (best-effort)
    try {
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://olybuddy-dashboard.vercel.app'}/auth/callback` },
      })
    } catch (linkErr) {
      console.error('Magic link generation failed (non-fatal):', linkErr)
    }

    return NextResponse.json({
      success: true,
      clientId,
      userId: authData?.user?.id ?? null,
      agentId: TEMPLATE_AGENT_ID,
      loginEmail: email,
      dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://olybuddy-dashboard.vercel.app'}/login`,
    })

  } catch (e) {
    console.error('Onboard error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
