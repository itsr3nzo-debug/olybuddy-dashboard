import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const STAGES = [
  { key: 'new',          label: 'New',          color: '#6366f1', bg: '#eef2ff' },
  { key: 'contacted',    label: 'Contacted',     color: '#f59e0b', bg: '#fffbeb' },
  { key: 'qualified',    label: 'Qualified',     color: '#3b82f6', bg: '#eff6ff' },
  { key: 'demo_booked',  label: 'Demo Booked',   color: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'demo_done',    label: 'Demo Done',     color: '#06b6d4', bg: '#ecfeff' },
  { key: 'proposal',     label: 'Proposal',      color: '#f97316', bg: '#fff7ed' },
  { key: 'negotiation',  label: 'Negotiation',   color: '#ec4899', bg: '#fdf2f8' },
  { key: 'won',          label: 'Won',           color: '#22c55e', bg: '#f0fdf4' },
  { key: 'lost',         label: 'Lost',          color: '#ef4444', bg: '#fef2f2' },
]

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  pipeline_stage: string
  last_contacted: string | null
  created_at: string
}

function timeAgo(ts: string | null): string {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default async function PipelinePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  let contacts: Contact[] = []

  if (clientId) {
    const { data } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, phone, email, source, pipeline_stage, last_contacted, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
    contacts = (data ?? []) as Contact[]
  }

  const byStage: Record<string, Contact[]> = {}
  for (const s of STAGES) byStage[s.key] = []
  for (const c of contacts) {
    if (byStage[c.pipeline_stage]) byStage[c.pipeline_stage].push(c)
    else byStage['new'].push(c)
  }

  const won = byStage['won'].length
  const total = contacts.length

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Pipeline</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {total} contacts · {won} won
          {total > 0 && won > 0 ? ` · ${Math.round(won / total * 100)}% conversion` : ''}
        </p>
      </div>

      {!clientId && (
        <div className="rounded-xl p-4 mb-6 border" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>
            <strong>Setup required:</strong> Account not linked to a business. Contact Olybuddy to complete onboarding.
          </p>
        </div>
      )}

      {/* Stage funnel summary */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {STAGES.filter(s => !['demo_done','proposal','negotiation'].includes(s.key)).map(stage => (
          <div key={stage.key} className="rounded-xl p-4 border" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
              <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{stage.label}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: stage.color }}>{byStage[stage.key].length}</p>
          </div>
        ))}
      </div>

      {/* Stage tables */}
      {STAGES.filter(s => byStage[s.key].length > 0).map(stage => (
        <div key={stage.key} className="mb-6 rounded-xl border overflow-hidden shadow-sm" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          {/* Stage header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)', background: stage.bg }}>
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
            <span className="text-sm font-semibold" style={{ color: stage.color }}>{stage.label}</span>
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: stage.color + '20', color: stage.color }}>
              {byStage[stage.key].length}
            </span>
          </div>

          <table className="w-full">
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['Name', 'Phone', 'Source', 'Last Contact', 'Added'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byStage[stage.key].map((contact, i) => {
                const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.phone || 'Unknown'
                return (
                  <tr key={contact.id} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <td className="px-5 py-3 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                      {name}
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: 'var(--muted)' }}>
                      {contact.phone ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs capitalize" style={{ color: 'var(--muted)' }}>
                        {contact.source?.replace(/_/g, ' ') ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: 'var(--muted)' }}>
                      {timeAgo(contact.last_contacted)}
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: 'var(--muted)' }}>
                      {timeAgo(contact.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {contacts.length === 0 && clientId && (
        <div className="rounded-xl p-12 text-center border" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No contacts yet. They&apos;ll appear here as your AI Employee captures leads from calls.</p>
        </div>
      )}
    </div>
  )
}
