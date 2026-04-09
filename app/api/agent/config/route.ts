import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'
import { buildAgentPrompt, buildFirstMessage } from '@/lib/agent-prompt-builder'
import { updateAgent } from '@/lib/elevenlabs'

export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth

  const { data, error } = await supabase
    .from('agent_config')
    .select('*')
    .eq('client_id', clientId)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ config: data })
}

export async function PATCH(request: Request) {
  const body = await request.json()
  const auth = await authenticateAgentRequest(request, body.client_id)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { clientId, supabase } = auth

  const allowed = [
    'greeting_message', 'business_description', 'agent_name', 'tone',
    'hours', 'services', 'faqs', 'escalation_phone', 'escalation_rules',
    'notification_prefs', 'is_active',
  ]

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('agent_config')
    .update(updates)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sync to ElevenLabs
  let elevenlabsSynced = false
  try {
    const { data: fullConfig } = await supabase
      .from('agent_config')
      .select('*')
      .eq('client_id', clientId)
      .single()

    const config = fullConfig as Record<string, unknown> | null
    if (config?.agent_id) {
      const prompt = buildAgentPrompt(config as Parameters<typeof buildAgentPrompt>[0])
      const firstMessage = buildFirstMessage(config as Parameters<typeof buildFirstMessage>[0])
      elevenlabsSynced = await updateAgent(config.agent_id as string, prompt, firstMessage)
    }
  } catch (e) {
    console.error('ElevenLabs sync error:', e)
  }

  return NextResponse.json({ success: true, elevenlabsSynced })
}
