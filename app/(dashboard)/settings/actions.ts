'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function sanitizeText(input: unknown, maxLength: number = 500): string {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, maxLength)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function updateBusinessDetails(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { getUserSession, hasPermission } = await import('@/lib/rbac')
  const session = getUserSession(user)
  if (!hasPermission(session.role, 'edit_settings')) throw new Error('Permission denied')

  const clientId = session.clientId
  if (!clientId) throw new Error('No client linked')

  const name = sanitizeText(formData.get('name'), 200)
  const email = sanitizeText(formData.get('email'), 320)
  const phone = sanitizeText(formData.get('phone'), 20)

  if (!name) throw new Error('Business name is required')
  if (email && !isValidEmail(email)) throw new Error('Invalid email format')

  const { error } = await supabase
    .from('clients')
    .update({ name, email: email || null, phone: phone || null })
    .eq('id', clientId)

  if (error) throw new Error(error.message)
  revalidatePath('/settings')
}

export async function updateAgentConfig(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const clientId = user.app_metadata?.client_id
  if (!clientId) throw new Error('No client linked')

  const updates: Record<string, unknown> = {}

  const greetingMessage = formData.get('greeting_message')
  if (greetingMessage !== null) {
    updates.greeting_message = sanitizeText(greetingMessage, 300)
  }

  const businessDescription = formData.get('business_description')
  if (businessDescription !== null) {
    updates.business_description = sanitizeText(businessDescription, 1000)
  }

  const hoursJson = formData.get('hours') as string | null
  if (hoursJson) {
    try {
      const parsed = JSON.parse(hoursJson)
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid hours format')
      updates.hours = parsed
    } catch {
      throw new Error('Invalid operating hours data')
    }
  }

  const faqsJson = formData.get('faqs') as string | null
  if (faqsJson) {
    try {
      const parsed = JSON.parse(faqsJson)
      if (!Array.isArray(parsed)) throw new Error('Invalid FAQs format')
      updates.faqs = parsed
    } catch {
      throw new Error('Invalid FAQ data')
    }
  }

  const agentNameVal = formData.get('agent_name')
  if (agentNameVal !== null) {
    // Cap at 30 to match the DB CHECK constraint from
    // supabase-migration-employee-name.sql → agent_name_length_check.
    // Client UI also caps at 30; keeping server-side in sync avoids
    // silent constraint-violation 500s.
    const newName = sanitizeText(agentNameVal, 30) || 'Nexley'
    updates.agent_name = newName

    // CRITICAL: personality_prompt + greeting_message are free-text fields
    // written at signup and often embed the old agent_name (e.g. "You are
    // Nexley, the AI employee for ..."). When the owner renames, those
    // strings must be updated too, otherwise the agent sees contradictory
    // signals (agent_name=Aiden but personality_prompt="You are Nexley").
    // We do a word-boundary replace of the OLD name with the NEW name.
    const { data: existing } = await supabase
      .from('agent_config')
      .select('agent_name, personality_prompt, greeting_message')
      .eq('client_id', clientId)
      .single()

    const oldName = (existing?.agent_name ?? '').trim()
    if (existing && oldName && oldName !== newName) {
      const nameRegex = new RegExp(
        `\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'g',
      )
      // Never overwrite a field the caller explicitly set in THIS form.
      // If greeting_message is already in updates (from form section above),
      // respect it — the user's explicit edit wins over auto-rename.
      if (!('personality_prompt' in updates)
          && existing.personality_prompt
          && typeof existing.personality_prompt === 'string') {
        const updated = existing.personality_prompt.replace(nameRegex, newName)
        if (updated !== existing.personality_prompt) {
          updates.personality_prompt = updated
        }
      }
      if (!('greeting_message' in updates)
          && existing.greeting_message
          && typeof existing.greeting_message === 'string') {
        const updated = existing.greeting_message.replace(nameRegex, newName)
        if (updated !== existing.greeting_message) {
          updates.greeting_message = updated
        }
      }
    }
  }

  const toneVal = formData.get('tone') as string | null
  if (toneVal !== null && ['optimistic', 'balanced', 'analytical'].includes(toneVal)) {
    updates.tone = toneVal
  }

  const notifPrefs = formData.get('notification_prefs') as string | null
  if (notifPrefs) {
    try {
      const parsed = JSON.parse(notifPrefs)
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid prefs')
      updates.notification_prefs = parsed
    } catch {
      throw new Error('Invalid notification preferences')
    }
  }

  if (Object.keys(updates).length === 0) return

  const { error } = await supabase
    .from('agent_config')
    .update(updates)
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)

  // Sync to ElevenLabs agent (if agent_id configured)
  try {
    const { buildAgentPrompt, buildFirstMessage } = await import('@/lib/agent-prompt-builder')
    const { updateAgent } = await import('@/lib/elevenlabs')

    const { data: fullConfig } = await supabase
      .from('agent_config')
      .select('*')
      .eq('client_id', clientId)
      .single()

    if (fullConfig?.agent_id) {
      const prompt = buildAgentPrompt(fullConfig)
      const firstMessage = buildFirstMessage(fullConfig)
      const synced = await updateAgent(fullConfig.agent_id, prompt, firstMessage)
      if (!synced) console.error(`ElevenLabs sync failed for agent ${fullConfig.agent_id} — settings saved to DB but agent not updated`)
    }
  } catch (syncErr) {
    console.error('ElevenLabs sync error (non-fatal):', syncErr)
  }

  revalidatePath('/settings')
}
