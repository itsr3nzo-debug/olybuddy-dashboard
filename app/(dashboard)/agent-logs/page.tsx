'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/format'
import { Phone, MessageSquare, Mail, TrendingUp, StickyNote, Clock, Filter } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  call: <Phone size={12} />,
  sms: <MessageSquare size={12} />,
  whatsapp: <MessageSquare size={12} />,
  email: <Mail size={12} />,
  telegram: <Mail size={12} />,
  stage_change: <TrendingUp size={12} />,
  note: <StickyNote size={12} />,
  appointment: <Clock size={12} />,
}

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'call', label: 'Calls' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Email' },
  { key: 'stage_change', label: 'Stage Changes' },
  { key: 'note', label: 'Notes' },
]

interface Activity {
  id: string
  activity_type: string
  description: string | null
  created_at: string
  contacts?: { first_name: string | null; last_name: string | null; phone: string | null } | null
}

export default function AgentLogsPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [days, setDays] = useState(30)
  const supabaseRef = useRef(createClient())

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const supabase = supabaseRef.current
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const clientId = user.app_metadata?.client_id
    if (!clientId) { setLoading(false); return }

    const since = new Date()
    since.setDate(since.getDate() - days)

    let query = supabase
      .from('activities')
      .select('id, activity_type, description, created_at, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(200)

    if (filter !== 'all') {
      query = query.eq('activity_type', filter)
    }

    const { data } = await query
    setActivities((data ?? []) as unknown as Activity[])
    setLoading(false)
  }, [filter, days])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Agent Logs</h1>
        <p className="text-sm mt-1 text-muted-foreground">Every action your AI Employee has taken</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTER_OPTIONS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-brand-primary text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground border-none outline-none"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Log feed */}
      <div className="rounded-xl border bg-card" style={{ borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="divide-y divide-border">
            {[0,1,2,3,4,5].map(i => (
              <div key={i} className="flex gap-3 px-5 py-4">
                <div className="skeleton h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-3/4 rounded mb-2" />
                  <div className="skeleton h-3 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            icon={<Filter size={24} />}
            title="No logs found"
            description={filter !== 'all' ? 'Try changing your filter.' : 'Activity will appear here as your AI Employee handles calls and messages.'}
          />
        ) : (
          <div className="divide-y divide-border">
            {activities.map(a => {
              const contactName = a.contacts
                ? [a.contacts.first_name, a.contacts.last_name].filter(Boolean).join(' ')
                : null
              return (
                <div key={a.id} className="flex gap-3 px-5 py-4 hover:bg-muted/30 transition-colors">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    {ACTIVITY_ICONS[a.activity_type] ?? <Clock size={12} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">
                      {a.description || `${a.activity_type} activity`}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(a.created_at)}</span>
                      {contactName && (
                        <span className="text-xs text-brand-primary">· {contactName}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded-full h-fit">
                    {a.activity_type.replace('_', ' ')}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
