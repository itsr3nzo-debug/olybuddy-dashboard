'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useRealtimeCalls } from '@/lib/hooks/useRealtimeCalls'
import { createClient } from '@/lib/supabase/client'
import type { CallLog } from '@/lib/types'
import { callerDisplayName, formatDuration } from '@/lib/format'
import LiveIndicator from '@/components/shared/LiveIndicator'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'
import { MessageSquare, Phone } from 'lucide-react'

interface Activity {
  id: string
  type: 'call' | 'message'
  contact: string
  summary: string
  time: string
  direction: 'inbound' | 'outbound'
  channel?: string
}

interface DashboardRealtimeProps {
  initialCalls: CallLog[]
  clientId: string | undefined
}

export default function DashboardRealtime({ initialCalls, clientId }: DashboardRealtimeProps) {
  const [calls, setCalls] = useState<CallLog[]>(initialCalls)
  const [recentActivity, setRecentActivity] = useState<Activity[]>(() =>
    initialCalls.slice(0, 5).map(c => ({
      id: c.id,
      type: 'call' as const,
      contact: callerDisplayName(c),
      summary: c.summary || `${c.direction} call · ${formatDuration(c.duration_seconds)}`,
      time: c.started_at || c.created_at || '',
      direction: c.direction as 'inbound' | 'outbound',
    }))
  )

  const handleNewCall = useCallback((call: CallLog) => {
    setCalls(prev => [call, ...prev].slice(0, 10))
    const name = callerDisplayName(call)
    const dur = formatDuration(call.duration_seconds)
    toast.success(`New conversation from ${name}`, {
      description: `Duration: ${dur} · ${call.direction}`,
      icon: <Phone size={14} />,
    })
    setRecentActivity(prev => [{
      id: call.id,
      type: 'call' as const,
      contact: name,
      summary: `${call.direction} call · ${dur}`,
      time: call.started_at || call.created_at || new Date().toISOString(),
      direction: call.direction as 'inbound' | 'outbound',
    }, ...prev].slice(0, 8))
  }, [])

  const { isConnected } = useRealtimeCalls({ clientId, onNewCall: handleNewCall })

  // Also subscribe to comms_log for WhatsApp/SMS messages
  const [msgsConnected, setMsgsConnected] = useState(false)
  useEffect(() => {
    if (!clientId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`msgs-${clientId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'comms_log',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const msg = payload.new as { id: string; channel: string; direction: string; body: string; from_address: string; sent_at: string }
        const channelLabel = msg.channel === 'whatsapp' ? 'WhatsApp' : msg.channel === 'sms' ? 'SMS' : msg.channel
        if (msg.direction === 'inbound') {
          toast.success(`New ${channelLabel} message`, {
            description: msg.body?.slice(0, 80) || 'New message received',
            icon: <MessageSquare size={14} />,
          })
        }
        setRecentActivity(prev => [{
          id: msg.id,
          type: 'message' as const,
          contact: msg.from_address || 'Unknown',
          summary: msg.body?.slice(0, 60) || `${msg.direction} ${channelLabel}`,
          time: msg.sent_at || new Date().toISOString(),
          direction: msg.direction as 'inbound' | 'outbound',
          channel: msg.channel,
        }, ...prev].slice(0, 8))
      })
      .subscribe(status => setMsgsConnected(status === 'SUBSCRIBED'))

    return () => { supabase.removeChannel(channel) }
  }, [clientId])

  const bothConnected = isConnected || msgsConnected

  return (
    <div>
      {/* Activity Feed */}
      {recentActivity.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-foreground">Live Activity</h2>
            <LiveIndicator isConnected={bothConnected} />
          </div>
          <div className="space-y-2">
            {recentActivity.slice(0, 5).map((a, i) => (
              <div
                key={a.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                style={{ borderColor: 'var(--border)', animationDelay: `${i * 50}ms` }}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  a.type === 'call' ? 'bg-violet-500/10 text-violet-500' : 'bg-brand-primary/10 text-brand-primary'
                }`}>
                  {a.type === 'call' ? <Phone size={14} /> : <MessageSquare size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{a.contact}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.summary}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    a.direction === 'inbound' ? 'bg-brand-success/10 text-brand-success' : 'bg-blue-500/10 text-blue-500'
                  }`}>
                    {a.direction === 'inbound' ? '← In' : '→ Out'}
                  </span>
                  {a.time && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(a.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Calls Table (kept for backward compat) */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Conversations</h2>
        <LiveIndicator isConnected={bothConnected} />
      </div>
      <RecentCallsTable calls={calls} />
    </div>
  )
}
