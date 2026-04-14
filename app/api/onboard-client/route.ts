import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { buildAgentPrompt, buildFirstMessage } from '@/lib/agent-prompt-builder'
import { updateAgent, createAgent } from '@/lib/elevenlabs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const TEMPLATE_AGENT_ID = process.env.ELEVENLABS_TEMPLATE_AGENT_ID ?? 'agent_1401kncgtzv4e9ws3mp87w5f08fm'

export async function POST(request: NextRequest) {
  // Auth — ALWAYS required (fail closed, not open)
  const apiKey = request.headers.get('x-api-key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { business_name, email, phone, industry = 'general', plan = 'starter' } = body

    if (!business_name || !email) {
      return NextResponse.json({ error: 'business_name and email are required' }, { status: 400 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Generate unique slug (handle collision with suffix)
    let slug = business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const { data: existingSlugs } = await supabase
      .from('clients')
      .select('slug')
      .like('slug', `${slug}%`)
    if (existingSlugs && existingSlugs.length > 0) {
      slug = `${slug}-${existingSlugs.length + 1}`
    }

    // Step 1: Create client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        name: business_name,
        slug,
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

    // Step 2: Create per-client ElevenLabs agent (clone from template)
    let agentId: string | null = null
    try {
      agentId = await createAgent(TEMPLATE_AGENT_ID, `${business_name} AI Employee`)
    } catch (e) {
      console.error('Agent creation failed (non-fatal, using template):', e)
    }
    // Fallback to template if creation fails
    if (!agentId) agentId = TEMPLATE_AGENT_ID

    // Step 3: Create agent_config
    const defaultHours = {
      mon: { open: '09:00', close: '17:00' }, tue: { open: '09:00', close: '17:00' },
      wed: { open: '09:00', close: '17:00' }, thu: { open: '09:00', close: '17:00' },
      fri: { open: '09:00', close: '17:00' }, sat: 'closed', sun: 'closed',
    }

    const { error: configErr } = await supabase.from('agent_config').insert({
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
      agent_id: agentId,
    })

    if (configErr) {
      // Clean up: delete the client row AND the orphaned ElevenLabs agent
      await supabase.from('clients').delete().eq('id', clientId)
      if (agentId && agentId !== TEMPLATE_AGENT_ID) {
        try {
          const { deleteAgent } = await import('@/lib/elevenlabs')
          await deleteAgent(agentId)
        } catch { /* best effort cleanup */ }
      }
      return NextResponse.json({ error: `Config creation failed: ${configErr.message}` }, { status: 500 })
    }

    // Step 4: Sync prompt to the agent
    try {
      const { data: config } = await supabase
        .from('agent_config').select('*').eq('client_id', clientId).single()
      if (config?.agent_id) {
        const prompt = buildAgentPrompt(config)
        const firstMessage = buildFirstMessage(config)
        await updateAgent(config.agent_id, prompt, firstMessage)
      }
    } catch (syncErr) {
      console.error('ElevenLabs sync on onboard failed (non-fatal):', syncErr)
    }

    // Step 5: Create auth user with app_metadata AND send invite in one step
    // Use createUser with email_confirm:false, then generate a magic link to send ourselves
    let userId: string | null = null
    let inviteSent = false

    try {
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: false,
        app_metadata: { client_id: clientId, role: 'owner' },
      })

      if (authErr) {
        console.error('Auth user creation failed:', authErr.message)
      } else {
        userId = authData.user?.id ?? null
      }

      // Generate magic link and send it via our system email
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://olybuddy-dashboard.vercel.app'}/auth/callback`,
        },
      })

      if (linkData?.properties?.action_link) {
        const { sendSystemEmail } = await import('@/lib/email')
        const result = await sendSystemEmail({
          to: email,
          subject: `Welcome to Nexley AI — Your AI Employee is ready`,
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">
              <h1 style="font-size:24px;">Welcome to Nexley AI!</h1>
              <p>Your AI Employee is set up and ready to answer calls for <strong>${business_name}</strong>.</p>
              <p>Click below to access your dashboard:</p>
              <a href="${linkData.properties.action_link}" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
                Open Dashboard
              </a>
              <p style="color:#666;font-size:13px;margin-top:24px;">This link expires in 1 hour. After that, use the magic link login on the dashboard.</p>
            </div>
          `,
        })
        inviteSent = result.success
      }
    } catch (invErr) {
      console.error('Auth/invite error:', invErr)
    }

    return NextResponse.json({
      success: true,
      clientId,
      userId,
      agentId,
      loginEmail: email,
      inviteSent,
      dashboardUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://olybuddy-dashboard.vercel.app'}/login`,
    })

  } catch (e) {
    console.error('Onboard error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
