'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Mail, Banknote, Calendar, CreditCard, MessageSquare, Bell } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Signal {
  id: number
  signal_id: string
  provider: string
  signal_type: string
  detected_at_iso: string
  summary: string
  urgency: 'emergency' | 'urgent' | 'normal' | 'low'
  confidence: number
  status: string
  proposed_action: { type?: string; params?: Record<string, unknown> } | null
  extracted_context: string | null
  customer_phone: string | null
  owner_note: string | null
}

// Provider emoji (📧💷📆💳💬) replaced with Lucide icons. Premium dashboards
// don't use emoji as provider markers — they use brand SVG (when available)
// or a semantic line icon (Linear / Stripe pattern).
const PROVIDER_ICON: Record<string, LucideIcon> = {
  gmail:           Mail,
  xero:            Banknote,
  quickbooks:      Banknote,
  google_calendar: Calendar,
  stripe:          CreditCard,
  slack:           MessageSquare,
}

// Urgency styles — token-based; was raw red-500 / amber-500.
const URGENCY_STYLE: Record<Signal['urgency'], string> = {
  emergency: 'border-destructive/40 bg-destructive/8 shadow-[inset_2px_0_0_0_var(--brand-danger)]',
  urgent:    'border-warning/40 bg-warning/8 shadow-[inset_2px_0_0_0_var(--brand-warning)]',
  normal:    'border-border bg-card',
  low:       'border-border bg-muted/20',
}

export function SignalsList({ initialSignals }: { initialSignals: Signal[] }) {
  const [signals, setSignals] = useState<Signal[]>(initialSignals)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Per-row in-flight state — previously a single isPending covered everything,
  // which made owner think clicks weren't registering during a sequence of approvals.
  const [inFlight, setInFlight] = useState<Record<string, 'approve' | 'reject' | undefined>>({})

  const pending = signals.filter(s => s.status === 'new')
  const approved = signals.filter(s => s.status === 'owner_approved')

  async function decide(signal_id: string, status: 'owner_approved' | 'owner_rejected') {
    const kind = status === 'owner_approved' ? 'approve' : 'reject'
    setInFlight(prev => ({ ...prev, [signal_id]: kind }))
    try {
      const res = await fetch(`/api/agent/integration-signals/${signal_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        toast.error(`Failed: ${detail.error || res.statusText}`)
        return
      }
      // Only update state AFTER server confirms — prevents stale optimistic state on failure
      setSignals(prev =>
        prev.map(s => (s.signal_id === signal_id ? { ...s, status } : s)),
      )
      toast.success(status === 'owner_approved' ? 'Approved — agent will act on this' : 'Rejected')
    } finally {
      setInFlight(prev => {
        const next = { ...prev }
        delete next[signal_id]
        return next
      })
    }
  }

  function Spinner() {
    return (
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    )
  }

  if (pending.length === 0 && approved.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <p className="text-muted-foreground">
          Nothing pending. Your AI is quietly watching your integrations — anything actionable
          will show up here within 15 minutes of being detected.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Awaiting your call ({pending.length})
          </h2>
          <ul className="space-y-3">
            {pending.map(s => (
              <li
                key={s.signal_id}
                className={`rounded-lg border p-4 transition ${URGENCY_STYLE[s.urgency]}`}
              >
                <div className="flex items-start gap-3">
                  {(() => {
                    const Icon = PROVIDER_ICON[s.provider] ?? Bell
                    return (
                      <Icon
                        size={18}
                        strokeWidth={1.5}
                        className="shrink-0 mt-0.5 text-muted-foreground"
                        aria-hidden
                      />
                    )
                  })()}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <span>{s.provider.replace('_', ' ')}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span>{s.signal_type.replace(/_/g, ' ')}</span>
                      <span className="text-muted-foreground/60">·</span>
                      <span className="font-mono tabular-nums">{new Date(s.detected_at_iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {s.urgency !== 'normal' && (
                        <>
                          <span className="text-muted-foreground/60">·</span>
                          <span
                            className={
                              s.urgency === 'emergency'
                                ? 'font-semibold text-destructive'
                                : s.urgency === 'urgent'
                                  ? 'font-semibold text-warning'
                                  : ''
                            }
                          >
                            {s.urgency}
                          </span>
                        </>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-foreground">{s.summary}</p>

                    {expanded === s.signal_id && (
                      <div className="mt-3 rounded-md bg-muted/40 p-3 text-xs">
                        <div className="font-medium text-muted-foreground">Proposed action</div>
                        <pre className="mt-1 overflow-x-auto text-xs text-foreground">
                          {JSON.stringify(s.proposed_action, null, 2)}
                        </pre>
                        {s.extracted_context && (
                          <>
                            <div className="mt-2 font-medium text-muted-foreground">Extracted context</div>
                            <p className="mt-1 text-xs text-foreground whitespace-pre-wrap">{s.extracted_context}</p>
                          </>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => decide(s.signal_id, 'owner_approved')}
                        disabled={!!inFlight[s.signal_id]}
                        aria-busy={inFlight[s.signal_id] === 'approve'}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {inFlight[s.signal_id] === 'approve' && <Spinner />}
                        {inFlight[s.signal_id] === 'approve' ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => decide(s.signal_id, 'owner_rejected')}
                        disabled={!!inFlight[s.signal_id]}
                        aria-busy={inFlight[s.signal_id] === 'reject'}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {inFlight[s.signal_id] === 'reject' && <Spinner />}
                        {inFlight[s.signal_id] === 'reject' ? 'Rejecting…' : 'Reject'}
                      </button>
                      <button
                        onClick={() => setExpanded(expanded === s.signal_id ? null : s.signal_id)}
                        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                      >
                        {expanded === s.signal_id ? 'Hide details' : 'Show details'}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {approved.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recently approved ({approved.length})
          </h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {approved.map(s => (
              <li key={s.signal_id} className="flex items-center gap-2 rounded-md px-3 py-1.5">
                {(() => {
                  const Icon = PROVIDER_ICON[s.provider] ?? Bell
                  return <Icon size={14} strokeWidth={1.5} className="text-muted-foreground" aria-hidden />
                })()}
                <span className="truncate">{s.summary}</span>
                <span className="ml-auto text-xs">
                  {new Date(s.detected_at_iso).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
