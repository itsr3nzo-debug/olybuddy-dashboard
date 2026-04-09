'use client'

import { useState } from 'react'
import type { CallLog } from '@/lib/types'
import { ChevronRight, Phone, PhoneOutgoing } from 'lucide-react'

function formatDuration(secs: number | null): string {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatTime(ts: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffH = diffMs / 3600000
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`
  if (diffH < 24) return `${Math.round(diffH)}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: 'Answered',  color: '#16a34a', bg: '#dcfce7' },
  failed:    { label: 'Failed',    color: '#dc2626', bg: '#fee2e2' },
  no_answer: { label: 'Missed',    color: '#d97706', bg: '#fef3c7' },
  voicemail: { label: 'Voicemail', color: '#7c3aed', bg: '#ede9fe' },
  busy:      { label: 'Busy',      color: '#dc2626', bg: '#fee2e2' },
}

interface TranscriptBubblesProps {
  transcript: CallLog['transcript']
  summary: string | null
}

function TranscriptBubbles({ transcript, summary }: TranscriptBubblesProps) {
  return (
    <div className="px-4 pb-4 pt-1">
      {summary && (
        <div className="mb-3 rounded-lg px-3 py-2.5 text-sm" style={{ background: 'var(--border)', color: 'var(--muted)' }}>
          <span className="font-semibold text-xs uppercase tracking-wide block mb-1" style={{ color: 'var(--muted)' }}>AI Summary</span>
          {summary}
        </div>
      )}
      {Array.isArray(transcript) && transcript.length > 0 && (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {transcript.map((turn, idx) => {
            const isAgent = turn.role === 'agent' || turn.role === 'assistant'
            const ts = turn.timestamp != null ? `${Math.floor(turn.timestamp / 60)}:${String(turn.timestamp % 60).padStart(2, '0')}` : null
            return (
              <div key={idx} className={`flex gap-2 ${isAgent ? 'justify-start' : 'justify-end'}`}>
                {isAgent && (
                  <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 text-xs font-bold" style={{ background: '#6366f120', color: 'var(--accent)' }}>A</div>
                )}
                <div
                  className="max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={isAgent
                    ? { background: '#6366f115', color: 'var(--foreground)', borderBottomLeftRadius: 4 }
                    : { background: 'var(--border)', color: 'var(--foreground)', borderBottomRightRadius: 4 }
                  }
                >
                  {turn.message}
                  {ts && <span className="block text-xs mt-0.5 opacity-50">{ts}</span>}
                </div>
                {!isAgent && (
                  <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 text-xs font-bold" style={{ background: 'var(--border)', color: 'var(--muted)' }}>C</div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {!summary && (!Array.isArray(transcript) || transcript.length === 0) && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No transcript available for this call.</p>
      )}
    </div>
  )
}

export default function RecentCallsTable({ calls }: { calls: CallLog[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Recent Calls</h2>
        <a href="/calls" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</a>
      </div>

      {calls.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Phone size={32} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--muted)' }} />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>Your AI Employee is standing by</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Call 07863 768 330 to see your first call appear here.</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {calls.map(call => {
            const sc = statusConfig[call.status] ?? statusConfig.completed
            const caller = call.contacts
              ? [call.contacts.first_name, call.contacts.last_name].filter(Boolean).join(' ') || call.from_number
              : call.from_number ?? 'Unknown'
            const hasDetail = call.summary || (Array.isArray(call.transcript) && call.transcript.length > 0)
            const isExpanded = expandedId === call.id

            return (
              <div key={call.id}>
                <button
                  onClick={() => hasDetail && setExpandedId(isExpanded ? null : call.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors"
                  style={{
                    cursor: hasDetail ? 'pointer' : 'default',
                    background: isExpanded ? 'var(--accent-light)' : 'transparent',
                  }}
                  disabled={!hasDetail}
                >
                  {/* Direction icon */}
                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--border)' }}>
                    {call.direction === 'inbound'
                      ? <Phone size={14} style={{ color: 'var(--accent)' }} />
                      : <PhoneOutgoing size={14} style={{ color: 'var(--success)' }} />
                    }
                  </div>

                  {/* Caller + summary */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>{caller}</p>
                    {call.summary && (
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>{call.summary}</p>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{formatDuration(call.duration_seconds)}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: sc.bg, color: sc.color }}>
                      {sc.label}
                    </span>
                    <span className="text-xs hidden sm:block" style={{ color: 'var(--muted)' }}>{formatTime(call.started_at)}</span>
                    {hasDetail && (
                      <ChevronRight size={14} style={{ color: 'var(--muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                    )}
                  </div>
                </button>

                {/* Expanded transcript */}
                {isExpanded && (
                  <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
                    <TranscriptBubbles transcript={call.transcript} summary={call.summary} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
