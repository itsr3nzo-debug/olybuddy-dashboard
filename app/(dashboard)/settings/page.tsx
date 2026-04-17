import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Settings | Nexley AI' }
import { redirect } from 'next/navigation'
import { PLAN_LABELS, SUBSCRIPTION_STATUS_CONFIG } from '@/lib/constants'
import { StatusBadge } from '@/components/ui/badge'
import { AI_PHONE_DISPLAY } from '@/lib/constants'
import type { AgentConfig, HoursConfig } from '@/lib/types'
import BusinessForm from '@/components/settings/BusinessForm'
import GreetingEditor from '@/components/settings/GreetingEditor'
import FaqEditor from '@/components/settings/FaqEditor'
import NotificationSettings from '@/components/settings/NotificationSettings'
import HoursGrid from '@/components/settings/HoursGrid'
import TeamSection from '@/components/settings/TeamSection'
import { Section } from '@/components/ui/card'

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
        <Section
          title="Sender Roles"
          description="Tell your AI Employee who's the boss — owner numbers vs customer numbers"
        >
          <a
            href="/settings/sender-roles"
            className="flex items-center justify-between -mx-5 sm:-mx-6 px-5 sm:px-6 py-4 hover:bg-muted/30 transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Manage owner numbers</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Business WhatsApp (what customers message), your personal number (you as boss), and aliases.
              </p>
            </div>
            <span className="text-sm text-brand-accent">Open →</span>
          </a>
        </Section>

        <Section
          title="Pricing rules"
          description="Your rate card — labour, markups, site loadings. Used for every quote draft."
        >
          <a
            href="/settings/pricing-rules"
            className="flex items-center justify-between -mx-5 sm:-mx-6 px-5 sm:px-6 py-4 hover:bg-muted/30 transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Edit rate card</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Labour £/hr, minimum call-out, markup tiers, site loadings. Codify once, save hours on every estimate.
              </p>
            </div>
            <span className="text-sm text-brand-accent">Open →</span>
          </a>
        </Section>

        <Section title="Business Details" description="Your company information">
          <BusinessForm
            initialName={client?.name ?? ''}
            initialEmail={client?.email ?? ''}
            initialPhone={client?.phone ?? ''}
          />
        </Section>

        <Section title="AI Employee" description="Your AI team member configuration">
          <div className="divide-y divide-border -mx-5 sm:-mx-6">
            <SettingRow label="Conversations handled (all time)" value={totalCalls.toLocaleString()} />
            <SettingRow label="Voice" value="Nexley (British female)" />
            <SettingRow label="Provider" value="ElevenLabs" />
            <SettingRow label="Inbound number" value={AI_PHONE_DISPLAY} mono />
          </div>
        </Section>

        <Section title="Greeting Message" description="What customers hear when your AI Employee picks up">
          <GreetingEditor initialGreeting={config?.greeting_message ?? ''} />
        </Section>

        <Section title="Operating Hours" description="When your AI Employee is active">
          <HoursGrid initialHours={(config?.hours as HoursConfig) ?? defaultHours} />
        </Section>

        <Section title="FAQs" description="Help your AI answer common questions about your business">
          <FaqEditor initialFaqs={Array.isArray(config?.faqs) ? (config.faqs as { question: string; answer: string }[]) : []} />
        </Section>

        <Section title="Notifications" description="How you get alerted about messages and bookings">
          <NotificationSettings initialPrefs={(config?.notification_prefs as { email?: boolean; telegram?: boolean }) ?? {}} />
        </Section>

        <Section title="Subscription" description="Your plan and billing">
          <div className="divide-y divide-border -mx-5 sm:-mx-6">
            <SettingRow label="Status" value={<StatusBadge status={client?.subscription_status ?? 'active'} />} />
            <SettingRow label="Plan" value={PLAN_LABELS[client?.subscription_plan ?? ''] ?? 'AI Employee'} />
            {client?.subscription_status === 'trial' && client?.trial_ends_at && (
              <SettingRow label="Trial ends" value={new Date(client.trial_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
            )}
            <SettingRow label="Member since" value={memberSince} />
            {config?.twilio_phone && (
              <SettingRow label="Your AI WhatsApp number" value={config.twilio_phone} mono />
            )}
          </div>
        </Section>

        <Section title="Account" description="Login and security">
          <div className="divide-y divide-border -mx-5 sm:-mx-6">
            <SettingRow label="Login email" value={session.email ?? '—'} />
          </div>
        </Section>

        {/* Danger Zone */}
        <Section title="Danger Zone" description="Irreversible actions" className="border-red-500/20">
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Cancel subscription</p>
              <p className="text-xs text-muted-foreground">Your AI Employee will stop responding immediately</p>
            </div>
            <button className="px-3 py-1.5 rounded-lg text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
              Cancel plan
            </button>
          </div>
          <div className="flex items-center justify-between py-3 border-t border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Delete account</p>
              <p className="text-xs text-muted-foreground">Permanently remove all data including call logs and contacts</p>
            </div>
            <button className="px-3 py-1.5 rounded-lg text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
              Delete account
            </button>
          </div>
        </Section>

        <Section title="Need help?" description="For advanced configuration, subscription changes, or AI script updates">
          <a
            href="https://nexley.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline"
          >
            Contact Nexley AI →
          </a>
        </Section>

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
