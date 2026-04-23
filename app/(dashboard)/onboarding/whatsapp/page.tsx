'use client'

/**
 * /onboarding/whatsapp — Self-serve WhatsApp linking page.
 *
 * Reads live pairing state from `agent_config.wa_*` (populated by the VPS-side
 * `wa-state-sync.py` every 5s) via Supabase Realtime. Renders a QR (or the
 * 8-char pairing code) and automatically advances when status flips to
 * "connected". Zero operator involvement.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Loader2, RefreshCw, Smartphone, AlertTriangle, ArrowRight } from 'lucide-react'

interface WAState {
  wa_connection_status: 'unknown' | 'disconnected' | 'qr_ready' | 'code_ready' | 'connected'
  wa_qr_code: string | null
  wa_pairing_code: string | null
  wa_connection_jid: string | null
  wa_connection_name: string | null
  wa_state_updated_at: string | null
}

export default function WhatsAppLinkPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [clientId, setClientId] = useState<string | null>(null)
  const [state, setState] = useState<WAState | null>(null)
  const [qrImg, setQrImg] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)
  const lastQrRef = useRef<string | null>(null)

  // 1. Resolve current user + client_id
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const cid = (user?.app_metadata?.client_id as string | undefined) ?? null
      if (!cancelled) setClientId(cid)
    })()
    return () => { cancelled = true }
  }, [supabase])

  // 2. Initial fetch + Realtime subscription on agent_config row
  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('agent_config')
        .select('wa_connection_status, wa_qr_code, wa_pairing_code, wa_connection_jid, wa_connection_name, wa_state_updated_at')
        .eq('client_id', clientId)
        .maybeSingle()
      if (cancelled) return
      if (data) setState(data as WAState)
    }
    void load()

    const channel = supabase
      .channel(`wa-state:${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'agent_config', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const row = payload.new as WAState
          setState(row)
        },
      )
      .subscribe()

    // Fallback: poll every 4s (Realtime can miss in flaky networks)
    const poll = setInterval(load, 4000)

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [clientId, supabase])

  // 3. Render the raw baileys QR string into a PNG data URL
  useEffect(() => {
    if (!state?.wa_qr_code) {
      setQrImg(null)
      lastQrRef.current = null
      return
    }
    if (state.wa_qr_code === lastQrRef.current) return
    lastQrRef.current = state.wa_qr_code
    ;(async () => {
      try {
        const dataUrl = await QRCode.toDataURL(state.wa_qr_code!, {
          errorCorrectionLevel: 'L',
          margin: 2,
          width: 320,
          color: { dark: '#0a0a0a', light: '#ffffff' },
        })
        setQrImg(dataUrl)
      } catch {
        setQrImg(null)
      }
    })()
  }, [state?.wa_qr_code])

  // 4. When status flips to 'connected', wait a beat then advance
  const paired = state?.wa_connection_status === 'connected'
  useEffect(() => {
    if (!paired) return
    const t = setTimeout(() => router.push('/dashboard'), 2500)
    return () => clearTimeout(t)
  }, [paired, router])

  async function requestFreshCode() {
    if (!clientId || pinging) return
    setPinging(true)
    try {
      await fetch('/api/whatsapp/refresh', { method: 'POST' })
    } finally {
      setTimeout(() => setPinging(false), 4000)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (!clientId) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const statusLabel: Record<WAState['wa_connection_status'], string> = {
    unknown: 'Starting up…',
    disconnected: 'Waiting for the agent to come online',
    qr_ready: 'Scan the QR below',
    code_ready: 'Enter the pairing code',
    connected: 'Linked',
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/onboarding" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold mt-2">Link your WhatsApp</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your AI Employee lives on its own WhatsApp line. Scan the QR once — your business number
          stays linked after that.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        {/* Status banner */}
        <div className="flex items-center gap-2 mb-5">
          <span
            className={
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ' +
              (paired
                ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                : state?.wa_connection_status === 'qr_ready' || state?.wa_connection_status === 'code_ready'
                ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/20'
                : 'bg-amber-500/10 text-amber-600 border border-amber-500/20')
            }
          >
            {paired
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : state?.wa_connection_status === 'disconnected' || state?.wa_connection_status === 'unknown'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Smartphone className="w-3.5 h-3.5" />}
            {state ? statusLabel[state.wa_connection_status] : 'Loading…'}
          </span>
          {state?.wa_state_updated_at && (
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(state.wa_state_updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Body */}
        {paired ? (
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            </div>
            <h2 className="text-lg font-semibold">You're linked</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {state?.wa_connection_name ? <>WhatsApp: <strong>{state.wa_connection_name}</strong></> : 'WhatsApp is now connected'}
            </p>
            <p className="text-xs text-muted-foreground mt-3">Taking you to your dashboard…</p>
            <div className="mt-4">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90"
              >
                Go now <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        ) : state?.wa_connection_status === 'qr_ready' && qrImg ? (
          <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImg} alt="WhatsApp pairing QR" className="w-[280px] h-[280px]" />
            </div>
            <ol className="space-y-3 text-sm text-foreground/90">
              <li className="flex gap-2"><span className="font-semibold text-foreground">1.</span> Open <strong>WhatsApp</strong> on the phone you want to pair</li>
              <li className="flex gap-2"><span className="font-semibold text-foreground">2.</span> Go to <strong>Settings → Linked Devices</strong></li>
              <li className="flex gap-2"><span className="font-semibold text-foreground">3.</span> Tap <strong>Link a Device</strong></li>
              <li className="flex gap-2"><span className="font-semibold text-foreground">4.</span> Point the camera at the QR on the left</li>
              <li className="pt-1">
                <button
                  onClick={requestFreshCode}
                  disabled={pinging}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={'w-3 h-3 ' + (pinging ? 'animate-spin' : '')} />
                  {pinging ? 'Refreshing…' : 'Code expired? Request a fresh one'}
                </button>
              </li>
            </ol>
          </div>
        ) : state?.wa_connection_status === 'code_ready' && state.wa_pairing_code ? (
          <div className="py-4">
            <div className="flex flex-col items-center text-center mb-4">
              <div className="text-3xl font-mono tracking-[0.3em] bg-foreground/5 border border-border rounded-lg px-6 py-4 select-all">
                {state.wa_pairing_code.slice(0, 4)}-{state.wa_pairing_code.slice(4)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Valid for about 60 seconds</p>
            </div>
            <ol className="space-y-2 text-sm text-foreground/90 max-w-md mx-auto">
              <li className="flex gap-2"><span className="font-semibold">1.</span> WhatsApp → <strong>Settings → Linked Devices</strong></li>
              <li className="flex gap-2"><span className="font-semibold">2.</span> Tap <strong>Link a Device → Link with phone number instead</strong></li>
              <li className="flex gap-2"><span className="font-semibold">3.</span> Enter the 8-character code above</li>
            </ol>
            <div className="mt-5 flex justify-center">
              <button
                onClick={requestFreshCode}
                disabled={pinging}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={'w-3 h-3 ' + (pinging ? 'animate-spin' : '')} />
                {pinging ? 'Refreshing…' : 'Request a fresh code'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-3" />
            <h2 className="text-sm font-medium">Preparing your WhatsApp agent</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              The server is booting baileys and generating a link code. This normally takes
              15–30&nbsp;seconds.
            </p>
            {state?.wa_connection_status === 'disconnected' && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2 py-1 text-xs">
                <AlertTriangle className="w-3 h-3" />
                Agent disconnected — regenerating…
              </div>
            )}
            <button
              onClick={requestFreshCode}
              disabled={pinging}
              className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={'w-3 h-3 ' + (pinging ? 'animate-spin' : '')} />
              Force a fresh code
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        Having trouble? WhatsApp allows four linked devices per account. If you've hit the cap,
        unlink an old device first.
      </div>
    </div>
  )
}
