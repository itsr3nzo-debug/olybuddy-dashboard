import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings | Nexley AI' }
import { redirect } from 'next/navigation'
import { PLAN_LABELS, SUBSCRIPTION_STATUS_CONFIG } from '@/lib/constants'
import { AI_PHONE_DISPLAY } from '@/lib/constants'
import type { AgentConfig, HoursConfig } from '@/lib/types'
import BusinessForm from '@/components/settings/BusinessForm'
import GreetingEditor from '@/components/settings/GreetingEditor'
import FaqEditor from '@/components/settings/FaqEditor'
import NotificationSettings from '@/components/settings/NotificationSettings'
import HoursGrid from '@/components/settings/HoursGrid'
import TeamSection from '@/components/settings/TeamSection'

export default async function SettingsPage() {
  const { requireAccess } = await import('@/lib/rbac-guard')
  const session = await requireAccess('/settings')

  const supabase = await createClient()
  const clientId = session.clientId

  let client: {
    id: string; name: string; email: string | null; phone: string | null
    subscription_status: string; subscription_plan: string; created_at: string
    trial_ends_at: string | null
  } | null = null
  let config: AgentConfig | null = null
  let totalCalls = 0

  if (clientId) {
    const { data } = await supabase
      .from('clients')
      .select('id, name, email, phone, subscription_status, subscription_plan, created_at, trial_ends_at')
      .eq('id', clientId)
      .single()
    client = data

    const { data: agentData } = await supabase
      .from('agent_config')
      .select('*')
      .eq('client_id', clientId)
      .single()
    config = agentData as AgentConfig | null

    const { count } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    totalCalls = count ?? 0
  }

  const statusInfo = SUBSCRIPTION_STATUS_CONFIG[client?.subscription_status ?? 'trial']
  const memberSince = client?.created_at
    ? new Date(client.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  const defaultHours: HoursConfig = {
    mon: { open: '09:00', close: '17:00' },
    tue: { open: '09:00', close: '17:00' },
    wed: { open: '09:00', close: '17:00' },
    thu: { open: '09:00', close: '17:00' },
    fri: { open: '09:00', close: '17:00' },
    sat: 'closed',
    sun: 'closed',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm mt-1 text-muted-foreground">Your AI Employee configuration and account details</p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border bg-brand-warning/5 border-brand-warning/20">
          <p className="text-sm text-brand-warning">
            <strong>Setup required:</strong> Account not linked to a business. Contact Nexley AI to complete onboarding.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Business Details (Editable) */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Business Details</h2>
          </div>
          <div className="px-6 py-5">
            <BusinessForm
              initialName={client?.name ?? ''}
              initialEmail={client?.email ?? ''}
              initialPhone={client?.phone ?? ''}
            />
          </div>
        </section>

        {/* AI Employee Info (Read-only) */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">AI Employee</h2>
          </div>
          <div className="px-6 divide-y divide-border">
            <SettingRow label="Calls handled (all time)" value={totalCalls.toLocaleString()} />
            <SettingRow label="Voice" value="Ava (British female)" />
            <SettingRow label="Provider" value="ElevenLabs" />
            <SettingRow label="Inbound number" value={AI_PHONE_DISPLAY} mono />
          </div>
        </section>

        {/* Greeting Message */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Greeting Message</h2>
          </div>
          <div className="px-6 py-5">
            <GreetingEditor initialGreeting={config?.greeting_message ?? ''} />
          </div>
        </section>

        {/* Operating Hours */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Operating Hours</h2>
          </div>
          <div className="px-6 py-5">
            <HoursGrid initialHours={(config?.hours as HoursConfig) ?? defaultHours} />
          </div>
        </section>

        {/* FAQs */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">FAQs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Help your AI answer common questions about your business</p>
          </div>
          <div className="px-6 py-5">
            <FaqEditor initialFaqs={Array.isArray(config?.faqs) ? (config.faqs as { question: string; answer: string }[]) : []} />
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
          </div>
          <div className="px-6">
            <NotificationSettings initialPrefs={(config?.notification_prefs as { email?: boolean; telegram?: boolean }) ?? {}} />
          </div>
        </section>

        {/* Subscription */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Subscription</h2>
          </div>
          <div className="px-6 divide-y divide-border">
            <SettingRow
              label="Status"
              value={
                statusInfo ? (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.className}`}>
                    {statusInfo.label}
                  </span>
                ) : '—'
              }
            />
            <SettingRow label="Plan" value={PLAN_LABELS[client?.subscription_plan ?? ''] ?? 'AI Employee'} />
            {client?.subscription_status === 'trial' && client?.trial_ends_at && (
              <SettingRow label="Trial ends" value={new Date(client.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
            )}
            <SettingRow label="Member since" value={memberSince} />
            {config?.twilio_phone && (
              <SettingRow label="Your AI WhatsApp number" value={config.twilio_phone} mono />
            )}
          </div>
        </section>

        {/* Account */}
        <section className="rounded-xl border overflow-hidden bg-card-bg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Account</h2>
          </div>
          <div className="px-6 divide-y divide-border">
            <SettingRow label="Login email" value={session.email ?? '—'} />
          </div>
        </section>

        {/* Support */}
        <section className="rounded-xl border overflow-hidden p-6 bg-card-bg">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Need help?</h2>
          <p className="text-sm mb-4 text-muted-foreground">
            For advanced configuration, subscription changes, or AI script updates, contact the Nexley AI team.
          </p>
          <a
            href="https://nexley.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline"
          >
            Contact Nexley AI →
          </a>
        </section>

        {/* Team Members */}
        <TeamSection />
      </div>
    </div>
  )
}

function SettingRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-4">
      <span className="text-sm font-medium w-48 flex-shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-sm flex-1 text-right text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  )
}
