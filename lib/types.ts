/* ── Olybuddy Dashboard Types ─────────────────────── */
/* Matches SUPABASE-SCHEMA.sql exactly                  */

export interface Client {
  id: string
  name: string
  slug: string | null
  email: string | null
  phone: string | null
  website: string | null
  industry: string | null
  subscription_status: 'trial' | 'active' | 'paused' | 'cancelled'
  subscription_plan: 'free' | 'starter' | 'pro' | 'enterprise'
  stripe_customer_id: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  client_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  company: string | null
  source: 'inbound_call' | 'cold_call' | 'cold_email' | 'website' | 'referral' | 'whatsapp' | 'telegram'
  pipeline_stage: PipelineStage
  tags: string[]
  custom_fields: Record<string, unknown>
  assigned_to: string | null
  last_contacted: string | null
  created_at: string
  updated_at: string
}

export type PipelineStage =
  | 'new' | 'contacted' | 'qualified' | 'demo_booked'
  | 'demo_done' | 'proposal' | 'negotiation' | 'won' | 'lost'

export interface TranscriptTurn {
  role: 'agent' | 'user' | 'assistant'  // ElevenLabs may send 'assistant'
  message: string
  timestamp?: number
  time_in_call_secs?: number
}

export interface CallLog {
  id: string
  client_id: string
  contact_id: string | null
  provider: 'elevenlabs' | 'twilio' | 'vapi' | 'retell'
  external_call_id: string | null
  direction: 'inbound' | 'outbound'
  from_number: string | null
  to_number: string | null
  status: 'completed' | 'failed' | 'no_answer' | 'busy' | 'voicemail'
  duration_seconds: number | null
  started_at: string | null
  ended_at: string | null
  transcript: TranscriptTurn[] | null
  transcript_text: string | null
  summary: string | null
  analysis: Record<string, unknown>
  sentiment: 'positive' | 'neutral' | 'negative' | null
  recording_url: string | null
  metadata: Record<string, unknown>
  created_at: string
  contacts?: {
    first_name: string | null
    last_name: string | null
    phone: string | null
  }
}

export interface Opportunity {
  id: string
  client_id: string
  contact_id: string | null
  title: string
  stage: PipelineStage
  value_pence: number
  currency: string
  probability: number
  expected_close: string | null
  closed_at: string | null
  lost_reason: string | null
  assigned_to: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CommsLog {
  id: string
  client_id: string
  contact_id: string | null
  channel: 'sms' | 'whatsapp' | 'email' | 'telegram'
  direction: 'inbound' | 'outbound'
  subject: string | null
  body: string | null
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'replied' | 'bounced' | 'failed'
  provider: string | null
  external_id: string | null
  thread_id: string | null
  metadata: Record<string, unknown>
  sent_at: string
}

export interface Activity {
  id: string
  client_id: string
  contact_id: string | null
  activity_type: 'call' | 'sms' | 'whatsapp' | 'email' | 'telegram' | 'stage_change' | 'note' | 'appointment' | 'demo_sent' | 'demo_viewed'
  description: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface ServiceConfig {
  name: string
  description?: string
  price_from?: number
}

export interface HoursConfig {
  [day: string]: { open: string; close: string } | 'closed'
}

export type AgentStatus = 'online' | 'offline' | 'in_call' | 'idle'
export type AgentTone = 'professional' | 'friendly' | 'confident' | 'cheeky' | 'calm' | 'energetic' | 'funny' | 'flirty'

export interface FaqItem {
  question: string
  answer: string
}

export interface AgentConfig {
  id: string
  client_id: string
  business_name: string
  business_description: string | null
  services: ServiceConfig[]
  prices: Record<string, unknown>
  hours: HoursConfig
  agent_id: string | null
  twilio_phone: string | null
  escalation_phone: string | null
  greeting_message: string | null
  // AI Employee identity (Sprint 2)
  agent_name: string
  agent_status: AgentStatus
  is_active: boolean
  last_call_at: string | null
  tone: AgentTone
  faqs: FaqItem[]
  escalation_rules: Record<string, unknown>[]
  notification_prefs: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DashboardStats {
  totalCalls: number
  callsToday: number
  callsAnswered: number
  callsMissed: number
  avgDuration: number
  callVolume: Array<{ date: string; calls: number }>
}
