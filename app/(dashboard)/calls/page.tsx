'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallLog } from '@/lib/types'

function formatDuration(secs: number | null): string {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDateTime(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const statusColors: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#f0fdf4', text: '#15803d' },
  failed:    { bg: '#fef2f2', text: '#b91c1c' },
  no_answer: { bg: '#fffbeb', text: '#b45309' },
  voicemail: { bg: '#eef2ff', text: '#4338ca' },
  busy:      { bg: '#fef2f2', text: '#b91c1c' },
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const supabase = createClient()

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const clientId = user.app_metadata?.client_id
    if (!clientId) { setLoading(false); return }

    let query = supabase
      .from('call_logs')
      .select('*, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .order('started_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (search.length >= 3) {
      query = query.ilike('from_number', `%${search}%`)
    }

    const { data } = await query
    setCalls((data ?? []) as CallLog[])
    setLoading(false)
  }, [supabase, page, statusFilter, search])

  useEffect(() => {
    fetchCalls()
  }, [fetchCalls])

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id)
  }

  const filtered = calls

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Call Log</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Every call your AI Employee handled</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Search by phone number..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          className="px-4 py-2 rounded-lg border text-sm outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--card-bg)', color: 'var(--foreground)', minWidth: 220 }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="px-4 py-2 rounded-lg border text-sm outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--card-bg)', color: 'var(--foreground)' }}
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="no_answer">No answer</option>
          <option value="voicemail">Voicemail</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl shadow-sm border overflow-hidden" style={{ background: 'var(--card-bg)', borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16" style={{ color: 'var(--muted)' }}>
            <svg className="animate-spin mr-2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Loading calls...
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Caller', 'Direction', 'Duration', 'Status', 'Date & Time', 'Summary'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm" style={{ color: 'var(--muted)' }}>
                      No calls found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((call, i) => {
                    const sc = statusColors[call.status] ?? { bg: '#f8fafc', text: '#64748b' }
                    const caller = call.contacts
                      ? [call.contacts.first_name, call.contacts.last_name].filter(Boolean).join(' ') || call.from_number
                      : call.from_number ?? 'Unknown'
                    const isExpanded = expandedId === call.id
                    const hasDetail = call.summary || call.transcript

                    return (
                      <>
                        <tr
                          key={call.id}
                          onClick={() => hasDetail && toggleExpand(call.id)}
                          style={{
                            borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                            cursor: hasDetail ? 'pointer' : 'default',
                            background: isExpanded ? '#f8fafc' : 'transparent',
                          }}
                        >
                          <td className="px-5 py-3.5 text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                            <div className="flex items-center gap-2">
                              {hasDetail && (
                                <svg
                                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                                  stroke="var(--muted)" strokeWidth="2" strokeLinecap="round"
                                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
                                >
                                  <polyline points="9 18 15 12 9 6"/>
                                </svg>
                              )}
                              {caller}
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="text-xs font-medium capitalize" style={{ color: call.direction === 'inbound' ? '#4338ca' : '#0f766e' }}>
                              {call.direction}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--muted)' }}>
                            {formatDuration(call.duration_seconds)}
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize"
                              style={{ background: sc.bg, color: sc.text }}
                            >
                              {call.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--muted)' }}>
                            {formatDateTime(call.started_at)}
                          </td>
                          <td className="px-5 py-3.5 text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
                            <span className="truncate block">
                              {call.summary ? call.summary.slice(0, 80) + (call.summary.length > 80 ? '...' : '') : '—'}
                            </span>
                          </td>
                        </tr>

                        {/* Expanded Row */}
                        {isExpanded && (
                          <tr key={`${call.id}-expanded`} style={{ borderTop: '1px solid var(--border)' }}>
                            <td colSpan={6} className="px-6 py-5" style={{ background: '#f8fafc' }}>
                              {call.summary && (
                                <div className="mb-4">
                                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>AI Summary</p>
                                  <p className="text-sm" style={{ color: 'var(--foreground)' }}>{call.summary}</p>
                                </div>
                              )}
                              {call.transcript && Array.isArray(call.transcript) && call.transcript.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>Transcript</p>
                                  <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {call.transcript.map((turn, idx) => (
                                      <div
                                        key={idx}
                                        className="flex gap-3"
                                      >
                                        <span
                                          className="text-xs font-semibold w-16 flex-shrink-0 mt-0.5 capitalize"
                                          style={{ color: turn.role === 'agent' ? 'var(--accent)' : 'var(--muted)' }}
                                        >
                                          {turn.role === 'agent' ? 'AI' : 'Caller'}
                                        </span>
                                        <p className="text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
                                          {turn.message}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {call.transcript_text && !Array.isArray(call.transcript) && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Transcript</p>
                                  <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>{call.transcript_text}</p>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {filtered.length === PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg text-sm border disabled:opacity-40 transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)', background: 'var(--card-bg)' }}
                >
                  Previous
                </button>
                <span className="text-sm" style={{ color: 'var(--muted)' }}>Page {page + 1}</span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-lg text-sm border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)', background: 'var(--card-bg)' }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
