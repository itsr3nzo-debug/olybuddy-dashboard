'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Pause, Play, Loader2 } from 'lucide-react'

type Status = {
  paused: boolean
  paused_at: string | null
  paused_reason: string | null
  paused_by: string | null
}

export default function EmergencyControls() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/pause-agent', { credentials: 'include' })
        const json = await res.json()
        setStatus(json)
      } finally { setLoading(false) }
    })()
  }, [])

  async function toggle(pause: boolean) {
    setSubmitting(true); setMsg('')
    try {
      const res = await fetch('/api/settings/pause-agent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: pause, reason: pause ? (reason || undefined) : undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setStatus(s => s ? {
        ...s,
        paused: pause,
        paused_at: pause ? new Date().toISOString() : null,
        paused_reason: pause ? (reason || 'Paused by owner via dashboard') : null,
      } : null)
      setReason('')
      setMsg(pause ? '🛑 Agent paused. No outbound messages will send.' : '✅ Agent resumed. Normal operation.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="skeleton h-60 rounded-xl" />
  if (!status) return <div className="text-sm text-brand-danger">Could not load status</div>

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-5 ${
        status.paused
          ? 'bg-red-500/5 border-red-500/40'
          : 'bg-green-500/5 border-green-500/30'
      }`}>
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0">
            {status.paused
              ? <Pause size={20} className="text-red-400" />
              : <Play size={20} className="text-green-400" />}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {status.paused ? 'Agent is PAUSED' : 'Agent is ACTIVE'}
            </p>
            {status.paused && (
              <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                <p>Paused at: {status.paused_at && new Date(status.paused_at).toLocaleString('en-GB')}</p>
                {status.paused_by && <p>By: {status.paused_by}</p>}
                {status.paused_reason && <p>Reason: {status.paused_reason}</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {status.paused
                ? 'Customers messaging you still see their messages delivered to WhatsApp, but your AI Employee will NOT respond until you resume.'
                : 'Your AI Employee is handling inbound messages and sending proactive follow-ups per schedule.'}
            </p>
          </div>
        </div>

        {!status.paused && (
          <>
            <label className="block text-xs text-muted-foreground mb-1">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. On holiday · Emergency · Retraining the AI"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm mb-3"
            />
            <button
              onClick={() => toggle(true)}
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 text-sm transition-colors disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
              Pause agent now
            </button>
          </>
        )}

        {status.paused && (
          <button
            onClick={() => toggle(false)}
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Resume agent
          </button>
        )}
      </div>

      {msg && (
        <div className="rounded-xl border bg-card-bg p-3 text-sm text-muted-foreground">{msg}</div>
      )}

      <div className="rounded-xl border bg-card-bg p-5">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5" />
          <div className="flex-1 text-xs text-muted-foreground leading-relaxed space-y-2">
            <p className="font-medium text-foreground">When to use this</p>
            <ul className="space-y-1">
              <li>• Going on holiday and don&apos;t want overnight auto-replies</li>
              <li>• Investigating a complaint and want to stop outbound while you handle it</li>
              <li>• Testing changes to pricing / services before the AI sees them</li>
              <li>• Emergency — customer reporting something went wrong</li>
            </ul>
            <p className="pt-2">
              <strong>Important:</strong> paused does NOT delete messages or drop enquiries — they stay queued.
              The moment you resume, the AI catches up on anything it missed.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
