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

  const clientId = user.app_metadata?.client_id
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

  const servicesJson = formData.get('services') as string | null
  if (servicesJson) {
    try {
      const parsed = JSON.parse(servicesJson)
      if (!Array.isArray(parsed)) throw new Error('Invalid services format')
      updates.services = parsed
    } catch {
      throw new Error('Invalid services data')
    }
  }

  if (Object.keys(updates).length === 0) return

  const { error } = await supabase
    .from('agent_config')
    .update(updates)
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)
  revalidatePath('/settings')
}
