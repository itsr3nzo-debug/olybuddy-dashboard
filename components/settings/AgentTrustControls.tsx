'use client'

import { useEffect, useState } from 'react'
import { Shield, Check, AlertTriangle, Loader2, Save, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'

type TrustConfig = {
  trust_level: 0 | 1 | 2 | 3
  auto_send_threshold_gbp: number
  auto_send_max_booking_minutes: number
  auto_send_first_time_customer: boolean
  trust_level_changed_at: string | null
  trust_level_changed_by: string | null
}

const LEVELS = [
  {
    value: 0,
    title: 'Shadow',
    summary: 'Drafts everything. Nothing ever sends.',
    detail: 'The agent reads every incoming message and writes the reply it would have sent, but never delivers it. Pure observation mode. Useful for the first 24-48 hours with a new client to audit what the agent would have done before going live.',
    risk: 'No customer risk. You get zero reply speed.',
    badge: 'bg-slate-500/10 text-slate-300 border-slate-500/30',
  },
  {
    value: 1,
    title: 'Confirm all',
    summary: 'Drafts + holds every reply for your approval.',
    detail: 'The agent drafts a response and sends it to YOUR WhatsApp first. You reply "yes" to send, or "edit: <new text>" to revise, or "no" to skip. Customers see nothing until you approve. Acknowledgements ("got it, one sec") are the only exception — they auto-send.',
    risk: 'Safest. Zero customer-facing AI mistakes. But every customer reply adds 30s-5min friction while you approve. You WILL be prompting on your phone a lot.',
    badge: 'bg-warning/10 text-warning border-warning/30',
  },
  {
    value: 2,
    title: 'Confirm above threshold',
    summary: 'Auto-sends small stuff, holds big stuff.',
    detail: 'The agent auto-sends acknowledgements, info replies, qualifying questions, small quotes (≤ threshold), and short bookings (≤ booking cap). She holds big quotes, long bookings, first-time customer handovers, refunds, and destructive actions for your approval. Emergencies always escalate — never auto-reply.',
    risk: 'Recommended. Good balance: instant replies for 80% of messages, safety net on the 20% that commit money or time.',
    badge: 'bg-primary/10 text-primary border-primary/30',
  },
  {
    value: 3,
    title: 'Full trust',
    summary: 'Auto-sends everything except destructive actions.',
    detail: 'The agent auto-sends all customer replies including big quotes and bookings. The only things she holds are: refunds, cancellations with money implications, bulk messages, policy changes, and emergency triage (emergencies always go to you first, no reply sent).',
    risk: 'Fastest customer experience. Highest risk of a visible AI mistake if the agent misjudges price, tone, or context. Only flip to this after 1-2 weeks of level 2 with zero customer-facing errors.',
    badge: 'bg-success/10 text-success border-success/30',
  },
] as const

export default function AgentTrustControls() {
  const [cfg, setCfg] = useState<TrustConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Local form state (committed on Save)
  const [level, setLevel] = useState<0 | 1 | 2 | 3>(2)
  const [thresholdGbp, setThresholdGbp] = useState(100)
  const [maxBookingMin, setMaxBookingMin] = useState(60)
  const [autoSendFirstTime, setAutoSendFirstTime] = useState(false)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings/agent-trust', { credentials: 'include' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to load')
        setCfg(json)
        setLevel(json.trust_level)
        setThresholdGbp(json.auto_send_threshold_gbp)
        setMaxBookingMin(json.auto_send_max_booking_minutes)
        setAutoSendFirstTime(json.auto_send_first_time_customer)
      } catch (e: unknown) {
        setMsg(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/settings/agent-trust', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trust_level: level,
          auto_send_threshold_gbp: thresholdGbp,
          auto_send_max_booking_minutes: maxBookingMin,
          auto_send_first_time_customer: autoSendFirstTime,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setCfg(json)
      setMsg('Saved. Your agent will use these settings on the next customer message.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="skeleton h-96 rounded-xl" />
  if (!cfg) return <div className="text-sm text-brand-danger">Could not load — refresh to retry.</div>

  const dirty =
    level !== cfg.trust_level ||
    thresholdGbp !== cfg.auto_send_threshold_gbp ||
    maxBookingMin !== cfg.auto_send_max_booking_minutes ||
    autoSendFirstTime !== cfg.auto_send_first_time_customer

  return (
    <div className="space-y-6">
      {/* Level picker */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground tracking-tight mb-4 flex items-center gap-2">
          <Shield size={14} strokeWidth={1.5} className="text-muted-foreground" /> Trust level
        </h2>
        <div className="space-y-2">
          {LEVELS.map(l => (
            <label
              key={l.value}
              className={`block rounded-md border p-4 cursor-pointer transition-colors min-h-[44px] ${
                level === l.value
                  ? 'bg-primary/8 border-primary/40 shadow-[inset_2px_0_0_0_var(--primary)]'
                  : 'bg-card border-border hover:bg-muted/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="trust_level"
                  value={l.value}
                  checked={level === l.value}
                  onChange={() => setLevel(l.value as 0 | 1 | 2 | 3)}
                  // Tailwind's `accent-*` utility looks for --color-accent-{name}
                  // which we don't define for `primary`. Use the arbitrary value
                  // form so the radio's check tints to our navy primary instead
                  // of falling through to the OS default blue.
                  className="mt-1 flex-shrink-0 accent-[var(--primary)] size-4"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-2 h-5 rounded-sm text-[10px] font-medium border uppercase tracking-wider ${l.badge}`}>
                      Level {l.value}
                    </span>
                    <p className="text-sm font-semibold text-foreground tracking-tight">{l.title}</p>
                    {l.value === 2 && (
                      <span className="text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-2 h-5 inline-flex items-center rounded-sm border border-primary/30">Recommended</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 leading-snug">{l.summary}</p>
                  {level === l.value && (
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
                      <p>{l.detail}</p>
                      <p className="text-foreground/80"><span className="font-medium">Risk:</span> {l.risk}</p>
                    </div>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Thresholds (only meaningful when TL >= 2) */}
      {level >= 2 && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground tracking-tight flex items-center gap-2">
            <Info size={14} strokeWidth={1.5} className="text-muted-foreground" /> Auto-send thresholds
          </h2>
          <p className="text-xs text-muted-foreground">
            Fine-tune where &quot;small&quot; ends and &quot;needs your approval&quot; begins.
          </p>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Auto-send quotes up to (£)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0} max={500} step={10}
                value={thresholdGbp}
                onChange={e => setThresholdGbp(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-mono text-foreground w-16 text-right">£{thresholdGbp}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Quotes at or below £{thresholdGbp} auto-send. Above → held for your approval.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Auto-send bookings up to (minutes)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={15} max={240} step={15}
                value={maxBookingMin}
                onChange={e => setMaxBookingMin(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-mono text-foreground w-16 text-right">{maxBookingMin} min</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Bookings {maxBookingMin} minutes or shorter auto-send. Longer jobs → held for your approval.
            </p>
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSendFirstTime}
                onChange={e => setAutoSendFirstTime(e.target.checked)}
                className="mt-1 flex-shrink-0"
              />
              <div>
                <p className="text-sm text-foreground">Auto-send to first-time customers</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Off by default. When off, the agent holds the <em>first reply</em> to any never-seen-before phone number for your approval, regardless of size.
                  Recommended off for the first few weeks — it catches tone/positioning misfires before they reach a fresh customer.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Always-true safety rules */}
      <div className="rounded-lg border border-warning/30 bg-card shadow-[inset_2px_0_0_0_var(--brand-warning)] p-5">
        <h2 className="text-sm font-semibold text-foreground tracking-tight mb-2 flex items-center gap-2">
          <AlertTriangle size={14} strokeWidth={1.5} className="text-warning" /> Always escalated (cannot be overridden)
        </h2>
        <ul className="text-xs text-muted-foreground space-y-1.5">
          <li>• <span className="text-foreground">Emergencies</span> — keywords like &quot;sparks&quot;, &quot;burning smell&quot;, &quot;no power&quot;, &quot;gas leak&quot;, &quot;burst pipe&quot;, &quot;flooding&quot;, &quot;fire&quot; instantly ping you — no AI reply sent.</li>
          <li>• <span className="text-foreground">Refunds, cancellations, disputes</span> — always held for approval, even at trust level 3.</li>
          <li>• <span className="text-foreground">Bulk actions</span> (messaging 10+ contacts, deleting data) — always held.</li>
          <li>• <span className="text-foreground">Policy changes</span> (price lists, business hours, services offered) — always held.</li>
        </ul>
      </div>

      {/* Save */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground">
          {cfg.trust_level_changed_at && (
            <>Last changed {new Date(cfg.trust_level_changed_at).toLocaleString('en-GB')} by {cfg.trust_level_changed_by ?? 'owner'}</>
          )}
        </div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : dirty ? <Save size={14} strokeWidth={1.75} /> : <Check size={14} strokeWidth={1.75} />}
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>

      {msg && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">{msg}</div>
      )}
    </div>
  )
}
