'use client'

import { useState } from 'react'
import { Check, Send, X, PoundSterling, Wrench, Clock, FileText, ChevronDown, ChevronUp } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'

type Variation = {
  id: string
  logged_at: string
  job_external_id: string | null
  source_type: string | null
  raw_transcript: string | null
  description: string
  change_type: string | null
  parts_added: { item: string; qty: number }[]
  labour_mins: number | null
  price_gbp: number | null
  status: 'draft' | 'sent_to_client' | 'approved' | 'rejected' | 'invoiced'
  sent_at: string | null
  approved_at: string | null
}

const STATUS_LABEL = {
  draft: 'Draft',
  sent_to_client: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  invoiced: 'Invoiced',
}

// Replaced with <StatusBadge> primitive. `invoiced` and `approved` collapse
// onto `success` (no need to differentiate visually — the column already
// labels which is which).
const STATUS_TO_BADGE: Record<Variation['status'], string> = {
  draft:          'draft',
  sent_to_client: 'sent',
  approved:       'approved',
  rejected:       'rejected',
  invoiced:       'invoiced',
}

export default function VariationsList({ initial }: { initial: Variation[] }) {
  const [rows, setRows] = useState(initial)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  async function update(id: string, patch: Partial<Variation>) {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      const res = await fetch(`/api/variations/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('failed')
      const { variation } = await res.json()
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...variation } : r))
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const totalOpenValue = rows
    .filter(r => r.status === 'draft' || r.status === 'sent_to_client')
    .reduce((acc, r) => acc + Number(r.price_gbp || 0), 0)

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <FileText size={28} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">No variations logged</p>
        <p className="text-xs text-muted-foreground mt-1">
          Send the AI Employee a voice note when a scope change happens on site.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 flex items-center justify-between text-sm">
        <div>
          <span className="text-muted-foreground">Open variation value</span>
          <span className="ml-3 text-foreground font-medium text-lg">£{totalOpenValue.toLocaleString()}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {rows.filter(r => r.status === 'draft').length} draft · {rows.filter(r => r.status === 'sent_to_client').length} sent
        </span>
      </div>

      {rows.map(v => {
        const isOpen = expandedId === v.id
        return (
          <div key={v.id} className="rounded-xl border bg-card overflow-hidden">
            <div className="p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <StatusBadge status={STATUS_TO_BADGE[v.status]} />
                  {v.job_external_id && (
                    <span className="text-xs font-mono text-muted-foreground">Job {v.job_external_id}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.logged_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-foreground mb-2">{v.description}</p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {v.price_gbp != null && <span className="inline-flex items-center gap-1"><PoundSterling size={11} />{v.price_gbp}</span>}
                  {v.labour_mins != null && <span className="inline-flex items-center gap-1"><Clock size={11} />{v.labour_mins}m</span>}
                  {v.parts_added?.length > 0 && <span className="inline-flex items-center gap-1"><Wrench size={11} />{v.parts_added.length} part{v.parts_added.length === 1 ? '' : 's'}</span>}
                  {v.change_type && <span className="px-1.5 py-0.5 rounded bg-muted/30">{v.change_type}</span>}
                </div>
              </div>
              <button
                onClick={() => setExpandedId(isOpen ? null : v.id)}
                className="text-muted-foreground hover:text-foreground text-xs inline-flex items-center gap-1"
              >
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {isOpen && (
              <div className="border-t bg-muted/10 p-4 space-y-3 text-sm">
                {v.raw_transcript && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Captured from</p>
                    <p className="text-foreground bg-background rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{v.raw_transcript}</p>
                  </div>
                )}
                {v.parts_added?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Parts added</p>
                    <ul className="text-xs text-foreground space-y-0.5">
                      {v.parts_added.map((p, i) => <li key={i}>• {p.qty}× {p.item}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  {v.status === 'draft' && (
                    <>
                      <button
                        onClick={() => update(v.id, { status: 'sent_to_client' })}
                        disabled={busy[v.id]}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
                      >
                        <Send size={12} />
                        Mark sent to client
                      </button>
                      <button
                        onClick={() => update(v.id, { status: 'rejected' })}
                        disabled={busy[v.id]}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                      >
                        <X size={12} />
                        Cancel
                      </button>
                    </>
                  )}
                  {v.status === 'sent_to_client' && (
                    <>
                      <button
                        onClick={() => update(v.id, { status: 'approved' })}
                        disabled={busy[v.id]}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-success/40 bg-success/10 text-success text-xs font-medium hover:bg-success/15 active:bg-success/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Check size={12} strokeWidth={2} />
                        Client approved
                      </button>
                      <button
                        onClick={() => update(v.id, { status: 'rejected' })}
                        disabled={busy[v.id]}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                      >
                        <X size={12} />
                        Client rejected
                      </button>
                    </>
                  )}
                  {v.status === 'approved' && (
                    <button
                      onClick={() => update(v.id, { status: 'invoiced' })}
                      disabled={busy[v.id]}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/30 disabled:opacity-50"
                    >
                      Mark invoiced
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
