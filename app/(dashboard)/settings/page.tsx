import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: 'Trial',     color: '#d97706', bg: '#fef3c7' },
  active:    { label: 'Active',    color: '#16a34a', bg: '#dcfce7' },
  paused:    { label: 'Paused',    color: '#6b7280', bg: '#f3f4f6' },
  cancelled: { label: 'Cancelled', color: '#dc2626', bg: '#fee2e2' },
}

function SettingRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between py-4 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <span className="text-sm font-medium w-48 flex-shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={`text-sm flex-1 text-right ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--foreground)' }}>
        {value}
      </span>
    </div>
  )
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let client: {
    id: string
    name: string
    email: string | null
    phone: string | null
    slug: string | null
    subscription_status: string
    subscription_plan: string
    created_at: string
  } | null = null
  let totalCalls = 0

  if (clientId) {
    const { data } = await supabase
      .from('clients')
      .select('id, name, email, phone, slug, subscription_status, subscription_plan, created_at')
      .eq('id', clientId)
      .single()
    client = data

    const { count } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    totalCalls = count ?? 0
  }

  const statusInfo = STATUS_LABELS[client?.subscription_status ?? ''] ?? STATUS_LABELS['trial']
  const memberSince = client?.created_at
    ? new Date(client.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Settings</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Your AI Employee configuration and account details</p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>Setup required:</strong> Account not linked to a business. Contact Olybuddy to complete onboarding.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Business info */}
        <section className="rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Business</h2>
          </div>
          <div className="px-6">
            <SettingRow label="Business name" value={client?.name ?? '—'} />
            <SettingRow label="Contact email" value={client?.email ?? '—'} />
            <SettingRow label="Contact phone" value={client?.phone ?? '—'} />
            <SettingRow label="Member since" value={memberSince} />
          </div>
        </section>

        {/* AI Employee */}
        <section className="rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>AI Employee</h2>
          </div>
          <div className="px-6">
            <SettingRow label="Calls handled (all time)" value={totalCalls.toLocaleString()} />
            <SettingRow label="Voice" value="Daniel (British male)" />
            <SettingRow label="Provider" value="ElevenLabs + GPT-4o" />
            <SettingRow
              label="Inbound number"
              value="+44 7863 768 330"
              mono
            />
          </div>
        </section>

        {/* Subscription */}
        <section className="rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Subscription</h2>
          </div>
          <div className="px-6">
            <SettingRow
              label="Status"
              value={
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: statusInfo.bg, color: statusInfo.color }}
                >
                  {statusInfo.label}
                </span>
              }
            />
            <SettingRow label="Plan" value={PLAN_LABELS[client?.subscription_plan ?? ''] ?? 'Starter'} />
          </div>
        </section>

        {/* Account */}
        <section className="rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Account</h2>
          </div>
          <div className="px-6">
            <SettingRow label="Login email" value={user.email ?? '—'} />
          </div>
        </section>

        {/* Support */}
        <section className="rounded-xl border overflow-hidden p-6" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>Need changes?</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            To update your business details, change your AI Employee&apos;s script, or manage your subscription, contact the Olybuddy team.
          </p>
          <a
            href="https://olybuddy.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium"
            style={{ color: 'var(--accent)' }}
          >
            Contact Olybuddy
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </section>
      </div>
    </div>
  )
}
