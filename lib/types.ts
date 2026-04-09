export interface Client {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  subscription_status: 'trial' | 'active' | 'paused' | 'cancelled'
  subscription_plan: 'free' | 'starter' | 'pro' | 'enterprise'
  created_at: string
}

export interface CallLog {
  id: string
  client_id: string
  contact_id: string | null
  provider: string
  external_call_id: string | null
  direction: 'inbound' | 'outbound'
  from_number: string | null
  to_number: string | null
  status: 'completed' | 'failed' | 'no_answer' | 'busy' | 'voicemail'
  duration_seconds: number | null
  started_at: string | null
  ended_at: string | null
  transcript: Array<{ role: string; message: string; timestamp?: number }> | null
  transcript_text: string | null
  summary: string | null
  analysis: Record<string, unknown>
  recording_url: string | null
  created_at: string
  contacts?: {
    first_name: string | null
    last_name: string | null
    phone: string | null
  }
}

export interface DashboardStats {
  totalCalls: number
  callsToday: number
  callsAnswered: number
  callsMissed: number
  avgDuration: number
  callVolume: Array<{ date: string; calls: number }>
}
