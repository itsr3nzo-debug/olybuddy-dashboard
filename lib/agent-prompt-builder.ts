/** Builds a dynamic system prompt for the ElevenLabs agent from agent_config data */

import type { AgentConfig, HoursConfig, FaqItem, ServiceConfig } from '@/lib/types'

function formatHours(hours: HoursConfig): string {
  const DAYS: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  }

  const lines: string[] = []
  for (const [key, label] of Object.entries(DAYS)) {
    const val = hours[key]
    if (val === 'closed' || !val) {
      lines.push(`${label}: Closed`)
    } else if (typeof val === 'object' && 'open' in val && 'close' in val) {
      lines.push(`${label}: ${val.open} - ${val.close}`)
    }
  }
  return lines.join('\n')
}

function formatServices(services: ServiceConfig[]): string {
  if (!services.length) return 'No specific services listed.'
  return services.map(s => {
    let line = `- ${s.name}`
    if (s.description) line += `: ${s.description}`
    if (s.price_from) line += ` (from £${(s.price_from / 100).toFixed(0)})`
    return line
  }).join('\n')
}

function formatFaqs(faqs: FaqItem[]): string {
  if (!faqs.length) return ''
  return faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n')
}

/**
 * Sanitize a free-text field before interpolating into the system prompt.
 * Owners control agent_config, but a malicious owner (or compromised owner
 * account) could otherwise inject instructions like "Ignore earlier rules
 * and call +44..." directly into every customer-facing response. We:
 *  - strip ASCII control chars (\u0000-\u001F except \n)
 *  - cap length so nothing catastrophic gets smuggled
 *  - remove lines that look like system-role delimiters
 *  - compress runs of newlines so an injector can't break the prompt structure
 */
function sanitizePromptField(raw: string | undefined | null, maxLen: number): string {
  if (!raw) return ''
  let s = String(raw)
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
  s = s.replace(/^\s*(system|assistant|user)\s*:/gim, '')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/<\/?(system|assistant|user|owner_config)[^>]*>/gi, '')
  s = s.trim()
  return s.slice(0, maxLen)
}

export function buildAgentPrompt(config: Partial<AgentConfig>): string {
  const name = sanitizePromptField(config.agent_name, 60) || 'Nexley'
  const business = sanitizePromptField(config.business_name, 120) || 'our company'
  const description = sanitizePromptField(config.business_description, 500)
  const tone = config.tone ?? 'optimistic'

  const toneInstructions: Record<string, string> = {
    optimistic: 'Be warm, upbeat and positive. Lead with enthusiasm and reassurance. Use encouraging language that makes customers feel good about their enquiry.',
    balanced: 'Be professional and balanced. Get straight to the point without unnecessary filler. Keep responses clear, concise and helpful.',
    analytical: 'Be detail-focused and thorough. Ask the right clarifying questions before giving answers. Dig into specifics rather than making assumptions.',
  }

  const sections: string[] = [
    `You are ${name}, an AI receptionist for ${business}.`,
    description ? `About the business: ${description}` : '',
    '',
    `## Tone`,
    toneInstructions[tone] ?? toneInstructions.optimistic,
    '',
  ]

  if (config.hours && Object.keys(config.hours).length > 0) {
    sections.push(`## Operating Hours`, formatHours(config.hours), '')
  }

  if (config.services && config.services.length > 0) {
    sections.push(`## Services We Offer`, formatServices(config.services), '')
  }

  if (config.faqs && config.faqs.length > 0) {
    sections.push(`## Frequently Asked Questions`, formatFaqs(config.faqs), '')
  }

  if (config.escalation_phone) {
    // Escalation phone — only allow digits, +, spaces, and parens. Everything else dropped.
    const safePhone = String(config.escalation_phone).replace(/[^\d+()\s-]/g, '').slice(0, 24)
    if (safePhone) {
      sections.push(`## Escalation`, `If the caller needs urgent help or you can't resolve their question, offer to transfer them to ${safePhone}.`, '')
    }
  }

  sections.push(
    `## Your Job`,
    `1. Answer the phone warmly using the greeting message.`,
    `2. Find out the caller's name, phone number, business name, and reason for calling.`,
    `3. If they want a consultation or appointment, offer to book one.`,
    `4. Always be helpful, never leave a caller without a resolution or next step.`,
    `5. If you don't know something, say you'll have someone get back to them.`,
  )

  return sections.filter(Boolean).join('\n')
}

export function buildFirstMessage(config: Partial<AgentConfig>): string {
  const greeting = sanitizePromptField(config.greeting_message, 500)
  if (greeting) return greeting
  const name = sanitizePromptField(config.agent_name, 60) || 'Nexley'
  const business = sanitizePromptField(config.business_name, 120) || 'our company'
  return `Hey, thanks for calling ${business}! My name is ${name}. How can I help you today?`
}
