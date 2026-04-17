'use client'

import { useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2, Shield, AlertTriangle, Check } from 'lucide-react'

type State = {
  webhook_url: string | null
  token_masked: string | null
  has_token: boolean
  trust_level: number
}

const TRUST_LEVELS = [
  { value: 0, label: 'Shadow',          summary: 'Drafts everything. Nothing sends. First 14 days for new clients.' },
  { value: 1, label: 'Confirm all',     summary: 'Drafts + sends after explicit owner yes. Safe default.' },
  { value: 2, label: 'Confirm above',   summary: 'Auto-sends small stuff (<£100, <1hr), confirms above threshold.' },
  { value: 3, label: 'Full trust',      summary: 'Auto-sends everything except destructive ops (refunds, bulk deletes).' },
] as const

export default function InboundWebhookControls() {
  const [state, setState] = useState<State | null>(null)
  const [loading, setLoading] = useState(true)
  const [rotating, setRotating] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<'url' | 'token' | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/inbound-webhook', { credentials: 'include' })
        const json = await res.json()
        setState(json)
      } finally { setLoading(false) }
    })()
  }, [])

  async function rotate() {
    if (!confirm('Rotate the webhook token? Any external tool using the current token will need updating.')) return
    setRotating(true); setMsg('')
    try {
      const res = await fetch('/api/settings/inbound-webhook', { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setNewToken(json.token)
      setMsg('🔑 Token rotated. Copy it now — it will not be shown again.')
      // Refresh state
      const refresh = await fetch('/api/settings/inbound-webhook', { credentials: 'include' })
      setState(await refresh.json())
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setRotating(false) }
  }

  async function setTrust(level: number) {
    setUpdating(true); setMsg('')
    try {
      const res = await fetch('/api/settings/inbound-webhook', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trust_level: level }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setState(s => s ? { ...s, trust_level: level } : null)
      setMsg(`✅ Trust level set to ${TRUST_LEVELS[level].label}`)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally { setUpdating(false) }
  }

  async function copy(what: 'url' | 'token') {
    const value = what === 'url' ? state?.webhook_url : newToken
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  if (loading) return <div className="skeleton h-80 rounded-xl" />
  if (!state) return <div className="text-sm text-brand-danger">Could not load</div>

  return (
    <div className="space-y-6">
      {/* Webhook URL */}
      <div className="rounded-xl border bg-card-bg p-5">
        <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <KeyRound size={14} /> Webhook endpoint
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Point any external tool to this URL with a <code className="text-foreground">POST</code> request.
          Include <code className="text-foreground">Authorization: Bearer &lt;token&gt;</code> header.
        </p>

        <label className="block text-xs text-muted-foreground mb-1">URL</label>
        <div className="flex gap-2 mb-3">
          <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground font-mono truncate">
            {state.webhook_url ?? '—'}
          </code>
          <button
            onClick={() => copy('url')}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/30"
          >
            {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>

        <label className="block text-xs text-muted-foreground mb-1">Current token</label>
        <div className="flex gap-2 items-center">
          <code className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground font-mono">
            {state.token_masked ?? 'No token — rotate to create one'}
          </code>
          <button
            onClick={rotate}
            disabled={rotating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent text-white px-3 py-2 text-xs font-medium hover:bg-brand-accent/90 disabled:opacity-50"
          >
            {rotating ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
            {state.has_token ? 'Rotate' : 'Create'} token
          </button>
        </div>
      </div>

      {/* New token displayed once */}
      {newToken && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground mb-1">Your new token — copy it now</p>
              <p className="text-xs text-muted-foreground mb-3">This is the only time the full token is shown. If you lose it, rotate again.</p>
              <div className="flex gap-2">
                <code className="flex-1 rounded-lg border border-amber-500/40 bg-background px-3 py-2 text-xs font-mono text-foreground break-all">
                  {newToken}
                </code>
                <button
                  onClick={() => copy('token')}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/30"
                >
                  {copied === 'token' ? <Check size={12} /> : <Copy size={12} />}
                  {copied === 'token' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trust level */}
      <div className="rounded-xl border bg-card-bg p-5">
        <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <Shield size={14} /> Trust level
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          How much the agent can send without your explicit approval. Start at <strong>Confirm all</strong> — raise it when you trust the pattern.
        </p>
        <div className="space-y-2">
          {TRUST_LEVELS.map(t => (
            <label
              key={t.value}
              className={`block rounded-lg border p-3 cursor-pointer transition-colors ${
                state.trust_level === t.value
                  ? 'bg-brand-accent/10 border-brand-accent/40'
                  : 'bg-background border-border hover:bg-muted/10'
              } ${updating ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="trust_level"
                  value={t.value}
                  checked={state.trust_level === t.value}
                  onChange={() => setTrust(t.value)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.summary}</p>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {msg && (
        <div className="rounded-xl border bg-card-bg p-3 text-sm text-muted-foreground">{msg}</div>
      )}

      {/* Example payloads */}
      <div className="rounded-xl border bg-card-bg p-5">
        <h2 className="text-sm font-medium text-foreground mb-2">Example payloads</h2>
        <p className="text-xs text-muted-foreground mb-3">What your external tool should POST.</p>

        <p className="text-xs font-medium text-foreground mb-1">Website contact form</p>
        <pre className="text-xs bg-background rounded-lg border p-3 overflow-x-auto mb-3"><code>{`{
  "trigger_type": "new_lead",
  "source": "website_form",
  "payload": {
    "name": "Jane Smith",
    "email": "jane@example.co.uk",
    "phone": "07xxx xxx xxx",
    "service": "boiler service",
    "message": "Want a quote for a boiler service"
  }
}`}</code></pre>

        <p className="text-xs font-medium text-foreground mb-1">Calendly booking</p>
        <pre className="text-xs bg-background rounded-lg border p-3 overflow-x-auto mb-3"><code>{`{
  "trigger_type": "booking",
  "source": "calendly",
  "payload": {
    "name": "Jane Smith",
    "email": "jane@example.co.uk",
    "event_name": "Site visit",
    "start_time": "2026-05-02T14:00:00Z",
    "end_time": "2026-05-02T15:00:00Z"
  }
}`}</code></pre>

        <p className="text-xs font-medium text-foreground mb-1">Fathom call transcript</p>
        <pre className="text-xs bg-background rounded-lg border p-3 overflow-x-auto"><code>{`{
  "trigger_type": "call_transcript",
  "source": "fathom",
  "payload": {
    "attendees": ["Jane Smith", "Kade Dillon"],
    "transcript": "...",
    "action_items": ["Send quote by Thursday"]
  }
}`}</code></pre>
      </div>
    </div>
  )
}
