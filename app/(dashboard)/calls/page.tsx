'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallLog } from '@/lib/types'
import { formatDuration, formatDateTime, callerDisplayName } from '@/lib/format'
import { STATUS_CONFIG, DIRECTION_CONFIG } from '@/lib/constants'
import TranscriptBubbles from '@/components/shared/TranscriptBubbles'
import EmptyState from '@/components/shared/EmptyState'
import { ChevronRight, Phone, Search, MessageSquare, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

const AudioPlayer = dynamic(() => import('@/components/shared/AudioPlayer'), { ssr: false })

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  // Stable ref to avoid re-creating on every render
  const supabaseRef = useRef(createClient())

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    const supabase = supabaseRef.current
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const clientId = user.app_metadata?.client_id
    if (!clientId) { setLoading(false); return }

    // Escape wildcards in search to prevent pattern injection
    const safeSearch = search.replace(/[%_]/g, '\\$&')

    let query = supabase
      .from('call_logs')
      .select('*, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .order('started_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (safeSearch.length >= 3) {
      query = query.ilike('from_number', `%${safeSearch}%`)
    }

    const { data, error } = await query
    if (error) console.error('Failed to fetch calls:', error.message)
    setCalls((data ?? []) as CallLog[])
    setLoading(false)
  }, [page, statusFilter, search])

  useEffect(() => {
    fetchCalls()
  }, [fetchCalls])

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Call Log</h1>
          <p className="text-sm mt-1 text-muted-foreground">Every call your AI Employee handled</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by phone..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="pl-9 pr-4 py-2 rounded-lg border text-sm outline-none bg-card-bg text-foreground border-border focus:ring-2 focus:ring-ring min-w-[200px]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="px-4 py-2 rounded-lg border text-sm outline-none bg-card-bg text-foreground border-border focus:ring-2 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="no_answer">No answer</option>
          <option value="voicemail">Voicemail</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl shadow-sm border overflow-hidden bg-card-bg border-border">
        {loading ? (
          /* Skeleton loader */
          <div className="divide-y divide-border">
            <div className="grid grid-cols-6 gap-4 px-5 py-3 bg-muted/50">
              {[0,1,2,3,4,5].map(i => <div key={i} className="skeleton h-3 w-16 rounded" />)}
            </div>
            {[0,1,2,3,4].map(i => (
              <div key={i} className="grid grid-cols-6 gap-4 px-5 py-4">
                <div className="skeleton h-4 w-28 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-12 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-4 w-32 rounded" />
              </div>
            ))}
          </div>
        ) : calls.length === 0 ? (
          <EmptyState
            icon={<Phone size={24} />}
            title="No calls found"
            description={search || statusFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Calls will appear here once your AI Employee starts handling them.'}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    {['Caller', 'Direction', 'Duration', 'Status', 'Date & Time', 'Summary'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {calls.map((call) => {
                    const sc = STATUS_CONFIG[call.status]
                    const dc = DIRECTION_CONFIG[call.direction]
                    const caller = callerDisplayName(call)
                    const isExpanded = expandedId === call.id
                    const hasDetail = call.summary || call.transcript

                    return (
                      <CallRow
                        key={call.id}
                        call={call}
                        caller={caller}
                        sc={sc}
                        dc={dc}
                        isExpanded={isExpanded}
                        hasDetail={!!hasDetail}
                        onToggle={() => hasDetail && setExpandedId(prev => prev === call.id ? null : call.id)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden divide-y divide-border">
              {calls.map((call) => {
                const sc = STATUS_CONFIG[call.status]
                const caller = callerDisplayName(call)
                const isExpanded = expandedId === call.id
                const hasDetail = call.summary || call.transcript

                return (
                  <div key={call.id}>
                    <button
                      className="w-full px-4 py-3.5 text-left touch-target"
                      onClick={() => hasDetail && setExpandedId(prev => prev === call.id ? null : call.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{caller}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDuration(call.duration_seconds)} · {formatDateTime(call.started_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {sc && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${sc.className}`}>
                              {sc.label}
                            </span>
                          )}
                          {hasDetail && (
                            <ChevronRight size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && <ExpandedDetail call={call} />}
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {calls.length === PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 rounded-lg text-sm border disabled:opacity-40 transition-colors bg-card-bg text-foreground border-border"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">Page {page + 1}</span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-lg text-sm border transition-colors bg-card-bg text-foreground border-border"
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

/* ── Desktop table row ─────────────────────────────── */

function CallRow({ call, caller, sc, dc, isExpanded, hasDetail, onToggle }: {
  call: CallLog
  caller: string
  sc: (typeof STATUS_CONFIG)[string] | undefined
  dc: (typeof DIRECTION_CONFIG)[string] | undefined
  isExpanded: boolean
  hasDetail: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`transition-colors ${hasDetail ? 'cursor-pointer hover:bg-muted/30' : ''} ${isExpanded ? 'bg-muted/30' : ''}`}
      >
        <td className="px-5 py-3.5 text-sm font-medium text-foreground">
          <div className="flex items-center gap-2">
            {hasDetail && (
              <ChevronRight size={14} className={`text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
            )}
            {caller}
          </div>
        </td>
        <td className="px-5 py-3.5">
          {dc && <span className={`text-xs font-medium capitalize ${dc.className}`}>{dc.label}</span>}
        </td>
        <td className="px-5 py-3.5 text-sm text-muted-foreground">
          {formatDuration(call.duration_seconds)}
        </td>
        <td className="px-5 py-3.5">
          {sc && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${sc.className}`}>
              {sc.label}
            </span>
          )}
        </td>
        <td className="px-5 py-3.5 text-sm text-muted-foreground">
          {formatDateTime(call.started_at)}
        </td>
        <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-xs">
          <span className="truncate block">
            {call.summary ? call.summary.slice(0, 80) + (call.summary.length > 80 ? '...' : '') : '—'}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-muted/20">
            <ExpandedDetail call={call} />
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Expanded call detail ──────────────────────────── */

function ExpandedDetail({ call }: { call: CallLog }) {
  const [showSms, setShowSms] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [sending, setSending] = useState(false)

  async function sendSms() {
    if (!call.from_number || !smsText.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: call.from_number, body: smsText.trim() }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to send')
      toast.success('SMS sent')
      setSmsText('')
      setShowSms(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send SMS')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="px-6 py-5 space-y-4">
      {call.summary && (
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">AI Summary</p>
          <p className="text-sm text-foreground">{call.summary}</p>
        </div>
      )}

      {call.transcript && Array.isArray(call.transcript) && call.transcript.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Transcript</p>
          <TranscriptBubbles transcript={call.transcript} />
        </div>
      )}

      {call.transcript_text && !Array.isArray(call.transcript) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Transcript</p>
          <p className="text-sm whitespace-pre-wrap text-foreground">{call.transcript_text}</p>
        </div>
      )}

      {call.recording_url && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recording</p>
          <AudioPlayer url={call.recording_url} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        {call.from_number && (
          <a
            href={`tel:${call.from_number}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-primary/10 text-brand-primary transition-colors hover:bg-brand-primary/20"
          >
            <Phone size={12} /> Call Back
          </a>
        )}
        {call.from_number && !showSms && (
          <button
            onClick={() => setShowSms(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-success/10 text-brand-success transition-colors hover:bg-brand-success/20"
          >
            <MessageSquare size={12} /> Send SMS
          </button>
        )}
      </div>

      {/* SMS composer */}
      {showSms && call.from_number && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              SMS to {call.from_number}
            </p>
            <button onClick={() => { setShowSms(false); setSmsText('') }} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <textarea
            value={smsText}
            onChange={e => setSmsText(e.target.value)}
            rows={3}
            maxLength={1600}
            placeholder="Hi, this is your AI Employee following up..."
            className="w-full px-3 py-2 rounded-lg border text-sm bg-card-bg text-foreground border-border focus:ring-2 focus:ring-ring outline-none resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{smsText.length}/1600</span>
            <button
              onClick={sendSms}
              disabled={sending || !smsText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-success text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send size={12} />
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
