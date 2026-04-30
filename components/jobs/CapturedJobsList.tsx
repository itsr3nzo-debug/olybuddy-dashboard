'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { Mic, Image as ImageIcon, Forward, MessageSquare, Mail, Calendar, User, MapPin, Wrench, PoundSterling, Check, X, Archive, ChevronDown, ChevronUp } from 'lucide-react'

type CapturedJob = {
  id: string
  captured_at: string
  source_type: 'voice_note' | 'text' | 'photo' | 'whatsapp_forward' | 'email'
  raw_transcript: string | null
  attachment_urls: string[]
  extracted_client_name: string | null
  extracted_client_phone: string | null
  extracted_address: string | null
  extracted_action: string | null
  extracted_due: string | null
  extracted_due_date: string | null
  extracted_parts: { item: string; qty: number }[]
  extracted_cost_gbp: number | null
  status: 'pending_review' | 'pushed_to_fergus' | 'failed' | 'discarded'
  review_note: string | null
  pushed_at: string | null
}

const SOURCE_ICON = {
  voice_note: <Mic size={14} />,
  text: <MessageSquare size={14} />,
  photo: <ImageIcon size={14} />,
  whatsapp_forward: <Forward size={14} />,
  email: <Mail size={14} />,
}

// STATUS_COLOR removed — uses <StatusBadge> primitive from `components/ui/badge`
// which centralises the status→variant mapping. Adapter below maps the
// captured-job lifecycle keys onto the canonical status keys.
import { StatusBadge } from '@/components/ui/badge'

const STATUS_TO_BADGE: Record<CapturedJob['status'], string> = {
  pending_review:    'pending',
  pushed_to_fergus:  'booked',
  failed:            'failed',
  discarded:         'cancelled',
}

export default function CapturedJobsList({ initial }: { initial: CapturedJob[] }) {
  const [jobs, setJobs] = useState(initial)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending_review' | 'pushed_to_fergus' | 'discarded'>('all')
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  const visible = jobs.filter(j => filter === 'all' || j.status === filter)
  const pendingCount = jobs.filter(j => j.status === 'pending_review').length

  async function updateStatus(id: string, status: CapturedJob['status']) {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      const res = await fetch(`/api/captured-jobs/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('failed')
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status, pushed_at: status === 'pushed_to_fergus' ? new Date().toISOString() : j.pushed_at } : j))
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <Mic size={28} className="mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-foreground">No captures yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Send the AI Employee a voice note about a job and it will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        {(['all', 'pending_review', 'pushed_to_fergus', 'discarded'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg border transition-colors ${
              filter === f
                ? 'bg-brand-accent/10 border-brand-accent/40 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted/30'
            }`}
          >
            {f === 'all' ? 'All' : f === 'pending_review' ? `Pending (${pendingCount})` : f === 'pushed_to_fergus' ? 'Pushed' : 'Discarded'}
          </button>
        ))}
      </div>

      {visible.map(j => {
        const isOpen = expandedId === j.id
        return (
          <motion.div
            key={j.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border bg-card overflow-hidden"
          >
            <div className="p-4 flex items-start gap-3">
              <div className="flex-shrink-0 mt-1 text-muted-foreground">
                {SOURCE_ICON[j.source_type] ?? <MessageSquare size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {j.extracted_client_name || 'Unattributed'}
                  </span>
                  <StatusBadge status={STATUS_TO_BADGE[j.status]} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(j.captured_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-foreground mb-1">
                  {j.extracted_action || <span className="italic text-muted-foreground">No action extracted — raw transcript only</span>}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1.5">
                  {j.extracted_address && <span className="inline-flex items-center gap-1"><MapPin size={11} />{j.extracted_address}</span>}
                  {j.extracted_due && <span className="inline-flex items-center gap-1"><Calendar size={11} />{j.extracted_due}</span>}
                  {j.extracted_cost_gbp != null && <span className="inline-flex items-center gap-1"><PoundSterling size={11} />{j.extracted_cost_gbp}</span>}
                  {j.extracted_parts?.length > 0 && <span className="inline-flex items-center gap-1"><Wrench size={11} />{j.extracted_parts.length} part{j.extracted_parts.length === 1 ? '' : 's'}</span>}
                </div>
              </div>
              <button
                onClick={() => setExpandedId(isOpen ? null : j.id)}
                className="text-muted-foreground hover:text-foreground text-xs inline-flex items-center gap-1"
              >
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {isOpen ? 'Less' : 'More'}
              </button>
            </div>

            {isOpen && (
              <div className="border-t bg-muted/10 p-4 space-y-3 text-sm">
                {j.raw_transcript && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Raw transcript</p>
                    <p className="text-foreground bg-background rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap">{j.raw_transcript}</p>
                  </div>
                )}
                {j.extracted_parts?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Parts</p>
                    <ul className="text-xs text-foreground space-y-0.5">
                      {j.extracted_parts.map((p, i) => (
                        <li key={i}>• {p.qty}× {p.item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {j.extracted_client_phone && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Contact: </span>
                    <span className="font-mono">{j.extracted_client_phone}</span>
                  </div>
                )}
                {j.status === 'pending_review' && (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => updateStatus(j.id, 'pushed_to_fergus')}
                      disabled={busy[j.id]}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
                    >
                      <Check size={12} />
                      Mark pushed to job system
                    </button>
                    <button
                      onClick={() => updateStatus(j.id, 'discarded')}
                      disabled={busy[j.id]}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                    >
                      <X size={12} />
                      Discard
                    </button>
                  </div>
                )}
                {j.status !== 'pending_review' && (
                  <button
                    onClick={() => updateStatus(j.id, 'pending_review')}
                    disabled={busy[j.id]}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-50"
                  >
                    <Archive size={12} />
                    Back to review
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
