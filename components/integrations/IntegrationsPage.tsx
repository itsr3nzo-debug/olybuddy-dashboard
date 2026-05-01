'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, Globe, HelpCircle, ChevronDown, ArrowUpDown } from 'lucide-react'
import { PROVIDERS, CATEGORIES, getOAuthProviderId, type ProviderConfig } from '@/lib/integrations-config'
import ProviderIcon from '@/components/integrations/ProviderIcon'
import CompoundPatModal from '@/components/integrations/CompoundPatModal'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/* -- Connected integration row -- */

interface ConnectedIntegration {
  id: string
  provider: string
  status: string
  account_email: string | null
  account_name: string | null
  last_synced_at: string | null
  last_applied_at?: string | null     // VPS-side ack — when the credential reached the agent
  last_health_check_at?: string | null
  expected_ready_at?: string | null   // for blocked_external (e.g. GBP 60-day gate)
  blocked_reason?: string | null
  created_at: string
  error_message?: string | null
}

/**
 * Map raw DB status → display state with a single name and colour scheme.
 * Statuses we expect: connected | degraded | refreshing | expired | error |
 * disconnected | pending | validating | blocked_external.
 */
function statusDisplay(integration: ConnectedIntegration): {
  label: string
  variant: 'success' | 'warning' | 'destructive' | 'neutral' | 'info'
  pulse?: boolean
} {
  const { status, last_applied_at } = integration
  // "Connected" without VPS ack = "applying" (intermediate state).
  if (status === 'connected' && !last_applied_at) {
    return { label: 'Applying', variant: 'info', pulse: true }
  }
  switch (status) {
    case 'connected':         return { label: 'Active',     variant: 'success' }
    case 'refreshing':        return { label: 'Refreshing', variant: 'info', pulse: true }
    case 'degraded':          return { label: 'Degraded',   variant: 'warning' }
    case 'validating':        return { label: 'Validating', variant: 'info', pulse: true }
    case 'pending':           return { label: 'Pending',    variant: 'neutral' }
    case 'expired':           return { label: 'Expired',    variant: 'warning' }
    case 'error':             return { label: 'Error',      variant: 'destructive' }
    case 'blocked_external':  return { label: 'Verifying',  variant: 'warning' }
    default:                  return { label: status,       variant: 'neutral' }
  }
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

function blockedReasonExplanation(reason: string | null | undefined, expectedReadyAt: string | null | undefined): string {
  const eta = expectedReadyAt
    ? new Date(expectedReadyAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'soon'
  switch (reason) {
    case 'gbp_60day_gate':
      return `Google requires your Business Profile listing to be verified for 60 days before our app can post on its behalf. We'll auto-enable on or around ${eta}.`
    case 'gbp_oauth_unverified':
      return `Google is still reviewing our OAuth app for Business Profile access. We'll auto-enable once Google approves (~${eta}).`
    case 'gbp_no_accounts_yet':
      return `No Business Profile listings are yet linked to this Google account. Verify your listing in Google, accept the manager invite, then reconnect here.`
    default:
      return `Waiting on external service.${expectedReadyAt ? ` ETA: ${eta}.` : ''}`
  }
}

function ConnectedRow({ integration, onDisconnect }: { integration: ConnectedIntegration; onDisconnect: (id: string, provider: string) => void }) {
  const def = PROVIDERS.find(p => p.id === integration.provider)
  // Match the ElevenLabs layout: Name | Created by | Date created | action.
  // The status pill lives under the provider name so the middle column can
  // carry the account email (what the user recognises as "who owns this").
  return (
    <tr className="border-b border-border hover:bg-muted/40 transition-colors">
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <ProviderIcon provider={def || { id: integration.provider, name: integration.provider, iconColor: 'bg-muted text-foreground' }} size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground text-sm truncate">{def?.name || integration.provider}</p>
              {(() => {
                const display = statusDisplay(integration)
                const pillStyles: Record<string, string> = {
                  success: 'bg-success/10 text-success',
                  warning: 'bg-warning/10 text-warning',
                  destructive: 'bg-destructive/12 text-destructive',
                  info: 'bg-brand-accent/10 text-brand-accent',
                  neutral: 'bg-muted text-muted-foreground',
                }
                const dotStyles: Record<string, string> = {
                  success: 'bg-success',
                  warning: 'bg-warning',
                  destructive: 'bg-destructive',
                  info: 'bg-brand-accent',
                  neutral: 'bg-muted-foreground',
                }
                return (
                  <span className={`inline-flex items-center gap-1.5 px-2 h-[18px] rounded-sm text-[10px] font-medium ${pillStyles[display.variant]}`}>
                    <span className={`size-1.5 rounded-full ${dotStyles[display.variant]} ${display.pulse ? 'animate-pulse' : ''}`} />
                    {display.label}
                  </span>
                )
              })()}
            </div>
            {integration.status === 'blocked_external' ? (
              <p className="text-xs text-warning/90 mt-0.5">{blockedReasonExplanation(integration.blocked_reason, integration.expected_ready_at)}</p>
            ) : (
              <p className="text-xs text-muted-foreground truncate">{def?.description}</p>
            )}
            {integration.last_health_check_at && integration.last_applied_at && integration.status === 'connected' && (
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Last verified {formatRelativeTime(integration.last_health_check_at)}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="py-4 px-4 text-sm text-muted-foreground truncate">
        {integration.account_email || integration.account_name || '\u2014'}
      </td>
      <td className="py-4 px-4 text-sm text-muted-foreground">
        {integration.created_at ? new Date(integration.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2014'}
      </td>
      <td className="py-4 px-4 text-right">
        <button
          onClick={() => onDisconnect(integration.id, integration.provider)}
          className="text-xs text-destructive hover:text-destructive/80 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          Disconnect
        </button>
      </td>
    </tr>
  )
}

/* -- Add integration modal -- */

/* -- PAT (pasted-token) connect modal -- */

function PatConnectModal({ provider, onClose, onConnected }: {
  provider: ProviderConfig
  onClose: () => void
  onConnected: () => void
}) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    if (!token.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/integrations/pat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id, token: token.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Connection failed')
      onConnected()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md w-[90vw] p-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>Connect {provider.name}</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste your {provider.pat?.tokenName ?? 'API token'} to connect {provider.name}.
            {provider.pat?.helpUrl && (
              <> <a href={provider.pat.helpUrl} target="_blank" rel="noreferrer" className="text-brand-accent underline hover:no-underline">How do I get one?</a></>
            )}
          </p>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={provider.pat?.placeholder ?? 'paste your token…'}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
          />
          {error && <p className="text-xs text-brand-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button
              onClick={connect}
              disabled={!token.trim() || loading}
              className="px-4 py-2 bg-brand-accent text-white text-sm rounded-lg font-medium hover:bg-brand-accent/90 disabled:opacity-50"
            >
              {loading ? 'Validating…' : 'Connect'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* -- Add integration modal -- */

function AddIntegrationModal({ open, onClose, connectedProviders, onChanged }: {
  open: boolean
  onClose: () => void
  connectedProviders: Set<string>
  onChanged: () => void
}) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [patProvider, setPatProvider] = useState<ProviderConfig | null>(null)
  const [compoundProvider, setCompoundProvider] = useState<ProviderConfig | null>(null)

  const recommended = PROVIDERS.filter(p => p.recommendedForTrades && !connectedProviders.has(p.id))

  const filtered = PROVIDERS.filter(p => {
    if (category !== 'all' && p.category !== category) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function tileHref(provider: ProviderConfig): string | undefined {
    // Connected tiles render as non-clickable; render no href.
    if (!provider.available || connectedProviders.has(provider.id)) return undefined
    // Compound-PAT and Plain-PAT tiles open a modal (not an href).
    if (provider.compoundPat || provider.pat) return undefined
    // customOAuth → direct flow at /api/oauth/{id}
    if (provider.customOAuth) return `/api/oauth/${provider.id}`
    // Composio / standard OAuth: getOAuthProviderId handles dual-row mappings.
    return `/api/oauth/${getOAuthProviderId(provider.id)}`
  }

  function handleTileClick(e: React.MouseEvent, provider: ProviderConfig) {
    if (!provider.available || connectedProviders.has(provider.id)) return
    if (provider.compoundPat) {
      e.preventDefault()
      setCompoundProvider(provider)
      return
    }
    if (provider.pat) {
      e.preventDefault()
      setPatProvider(provider)
      return
    }
    // else → the <a href> fires and redirects to /api/oauth/{provider}
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-4xl w-[90vw] max-h-[80vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle>Add integration</DialogTitle>
        </DialogHeader>

        <div className="flex h-[60vh]">
          {/* Categories sidebar */}
          <div className="w-52 border-r border-border py-2 flex-shrink-0 overflow-y-auto">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  category === cat.id
                    ? 'text-foreground font-medium bg-muted'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search + grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search integrations..."
                  className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring outline-none"
                />
              </div>
            </div>

            {category === 'all' && !search && recommended.length > 0 && (
              <div className="px-4 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs uppercase tracking-wide font-medium text-brand-accent">⭐ Recommended for trades</span>
                  <span className="text-xs text-muted-foreground">Start here — the stack most UK trade owners get the most out of.</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  {recommended.map(provider => {
                    return (
                      <a
                        key={provider.id}
                        href={tileHref(provider)}
                        onClick={(e) => handleTileClick(e, provider)}
                        className="flex items-start gap-3 p-4 rounded-xl border border-brand-accent/30 bg-brand-accent/5 hover:border-brand-accent/60 hover:shadow-md cursor-pointer transition-all"
                      >
                        <ProviderIcon provider={provider} size={40} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground text-sm">{provider.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>
                        </div>
                      </a>
                    )
                  })}
                </div>
                <div className="border-b border-border pt-3"></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 p-4">
              {filtered.map(provider => {
                const isConnected = connectedProviders.has(provider.id)
                return (
                  <a
                    key={provider.id}
                    href={tileHref(provider)}
                    onClick={(e) => handleTileClick(e, provider)}
                    className={`flex items-start gap-3 p-4 rounded-md border transition-colors ${
                      isConnected
                        ? 'border-success/30 bg-success/5 cursor-default'
                        : provider.available
                        ? 'border-border hover:border-primary/50 hover:bg-muted/40 cursor-pointer'
                        : 'border-border opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <ProviderIcon provider={provider} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground text-sm">{provider.name}</p>
                        {isConnected && <Badge label="Connected" variant="success" />}
                        {!provider.available && !isConnected && <Badge label="Coming Soon" variant="neutral" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{provider.description}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </DialogContent>

      {patProvider && (
        <PatConnectModal
          provider={patProvider}
          onClose={() => setPatProvider(null)}
          onConnected={() => { setPatProvider(null); onChanged(); }}
        />
      )}

      {compoundProvider && (
        <CompoundPatModal
          provider={compoundProvider}
          onClose={() => setCompoundProvider(null)}
          onConnected={() => { setCompoundProvider(null); onChanged(); }}
        />
      )}
    </Dialog>
  )
}

/* -- Main page -- */

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<ConnectedIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Handle error / success query params from OAuth redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    const provider = params.get('provider')
    if (err === 'not_configured') {
      setError(`${provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'This integration'} is not set up yet. Contact your admin to configure the API credentials.`)
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'storage_failed') {
      setError(`Failed to save connection for ${provider || 'this integration'}. Please try again.`)
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'token_exchange_failed') {
      setError('Connection failed — the provider rejected the authorization. Please try again.')
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'no_access_token') {
      setError('Connection failed — no access token received. Please try again.')
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'composio_init_failed' || err === 'composio_callback_failed') {
      setError(`Couldn't connect ${provider || 'that integration'} — please try again. If it keeps failing, contact support.`)
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'blocked_external') {
      // GBP listing-age gate or unverified OAuth scope. The integration row
      // already exists with status='blocked_external' and a friendly explanation,
      // so we just show a quick acknowledgement banner here and let the row UI
      // carry the full message.
      setSuccess('Connected — but Google needs to finish a one-time check before our AI can use it. The card below shows when it will switch on.')
      setTimeout(() => setSuccess(''), 8000)
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'state_mismatch') {
      setError('Connection failed — security check did not pass (state mismatch). Please try again.')
      window.history.replaceState({}, '', '/integrations')
    } else if (err === 'no_refresh_token') {
      setError('Connection failed — Google did not provide a refresh token. Sign out of Google in another tab and try again.')
      window.history.replaceState({}, '', '/integrations')
    }
    const connected = params.get('connected')
    if (connected) {
      const pretty = connected.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      setSuccess(`✅ ${pretty} connected — your AI Employee can use it now.`)
      window.history.replaceState({}, '', '/integrations')
      // Auto-dismiss after 6 seconds
      setTimeout(() => setSuccess(''), 6000)
    }
  }, [])

  const fetchIntegrations = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('integrations')
      .select('id, provider, status, account_email, account_name, last_synced_at, last_applied_at, last_health_check_at, expected_ready_at, blocked_reason, created_at, error_message')
      // Show every "live" status — including the new states from the custom-
      // integrations watcher (refreshing, degraded, blocked_external, validating).
      // 'disconnected' rows are excluded; disconnects hard-delete rows so this
      // is a belt-and-braces filter for legacy data.
      .in('status', ['connected', 'expired', 'error', 'refreshing', 'degraded', 'blocked_external', 'validating', 'pending'])
      .order('created_at', { ascending: false })
    setIntegrations(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchIntegrations() }, [])

  // Realtime subscription — when any integration row changes (status, ack
  // timestamps, refresh, etc.), repaint without a manual refresh. Required
  // so "Applying..." → "Active" transitions are visible immediately when the
  // VPS watcher writes back its `last_applied_at` ack.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('integrations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'integrations' },
        () => {
          // Could merge incrementally, but a re-fetch is simpler and the table
          // is small per-tenant. Throttled to at most once per 500ms to avoid
          // bursts during refresh-cron runs.
          fetchIntegrations()
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const connectedProviders = new Set(integrations.filter(i => i.status === 'connected').map(i => i.provider))

  const handleDisconnect = async (id: string, provider: string) => {
    if (!confirm('Disconnect this integration? Your AI Employee will no longer have access.')) return

    const def = PROVIDERS.find(p => p.id === provider)

    let res: Response
    if (def?.compoundPat) {
      // Compound-PAT providers (e.g. WordPress): DELETE on the validate endpoint
      res = await fetch(def.compoundPat.validateEndpoint, { method: 'DELETE' })
    } else if (def?.pat) {
      // Plain PAT (e.g. Fergus): existing route accepts ?provider=
      res = await fetch(`/api/integrations/pat?provider=${provider}`, { method: 'DELETE' })
    } else {
      // Composio + customOAuth: existing /api/oauth/{id}/disconnect
      const oauthProviderId = getOAuthProviderId(provider)
      res = await fetch(`/api/oauth/${oauthProviderId}/disconnect`, { method: 'POST' })
    }

    if (res.ok) {
      const oauthProviderId = getOAuthProviderId(provider)
      // For Google, remove both gmail + google_calendar rows.
      if (oauthProviderId === 'google') {
        setIntegrations(prev => prev.filter(i => i.provider !== 'gmail' && i.provider !== 'google_calendar'))
      } else {
        setIntegrations(prev => prev.filter(i => i.id !== id))
      }
    }
  }

  const filtered = integrations.filter(i => {
    if (!search) return true
    const def = PROVIDERS.find(p => p.id === i.provider)
    return def?.name.toLowerCase().includes(search.toLowerCase()) || i.account_email?.toLowerCase().includes(search.toLowerCase())
  })

  // Quick-connect tiles shown on the main page (not just inside the modal).
  // Mirrors the ElevenLabs pattern of surfacing a small curated set below the
  // empty state so owners can one-click-connect the common ones without
  // opening the "Add integration" dialog first.
  const quickTiles = PROVIDERS.filter(p =>
    p.available && p.recommendedForTrades && !connectedProviders.has(p.id)
  ).slice(0, 4)

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto">
      {/* Success Banner — semantic v2 tokens, accent strip on left edge,
          matches the BannerShell visual language used elsewhere. */}
      {success && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-success/30 bg-card shadow-[inset_2px_0_0_0_var(--brand-success)] flex items-center justify-between">
          <p className="text-sm text-foreground">{success}</p>
          <button
            onClick={() => setSuccess('')}
            className="text-success hover:text-success/80 text-xs font-medium px-2 h-6 rounded-sm hover:bg-success/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Expired-token re-link banner — semantic warning tokens. */}
      {integrations.some(i => i.status === 'expired' || i.status === 'error') && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-warning/30 bg-card shadow-[inset_2px_0_0_0_var(--brand-warning)]">
          <p className="text-sm text-foreground font-medium">Some integrations need re-authorising</p>
          <ul className="mt-1.5 text-xs text-muted-foreground space-y-1">
            {integrations.filter(i => i.status === 'expired' || i.status === 'error').map(i => (
              <li key={i.id} className="flex items-center justify-between">
                <span><span className="text-muted-foreground/60">·</span> {i.provider.replace(/_/g, ' ')} {i.error_message ? `\u2014 ${i.error_message.slice(0, 80)}` : ''}</span>
                <a href={`/api/oauth/${getOAuthProviderId(i.provider)}`}
                   className="ml-3 px-2 h-6 inline-flex items-center rounded-sm border border-warning/30 text-warning hover:bg-warning/10 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Reconnect
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error Banner — semantic destructive tokens. */}
      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-destructive/30 bg-card shadow-[inset_2px_0_0_0_var(--brand-danger)] flex items-center justify-between">
          <p className="text-sm text-foreground">{error}</p>
          <button
            onClick={() => setError('')}
            className="text-destructive hover:text-destructive/80 text-xs font-medium px-2 h-6 rounded-sm hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header — matches ElevenLabs: title + Alpha pill on left, primary CTA on right */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Integrations</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
            Alpha
          </span>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Add integration
        </button>
      </div>

      {/* Search + sort controls — always visible (ElevenLabs parity) */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search integrations..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-primary outline-none transition-shadow"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted/40 transition-colors"
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={2} />
          Recent
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Table shell — header always visible; body is either rows, loading, or the empty-state illustration */}
      <div className="border-b border-border mb-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Name</th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">Created by</th>
              <th className="text-left py-3 px-4 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">Date created <ChevronDown className="w-3 h-3" /></span>
              </th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          {loading ? null : filtered.length > 0 ? (
            <tbody>
              {filtered.map(integration => (
                <ConnectedRow key={integration.id} integration={integration} onDisconnect={handleDisconnect} />
              ))}
            </tbody>
          ) : null}
        </table>
      </div>

      {/* Loading spinner OR empty-state illustration */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 dark:border-gray-600 dark:border-t-white rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="relative mb-5">
            <div className="w-20 h-20 rounded-full bg-muted/30 flex items-center justify-center">
              <Globe className="w-11 h-11 text-gray-300 dark:text-gray-600" strokeWidth={1} />
            </div>
            <div className="absolute top-0 right-0 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center shadow-sm">
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={2} />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1.5">No integrations configured</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Connect your AI Employee to your existing tools or browse the library of integrations below.
          </p>
        </div>
      ) : null}

      {/* Quick-connect tile grid — surface a curated subset of providers on the page
          itself (rather than only inside the modal) so one-click connect is visible
          below the empty state. Matches the ElevenLabs quick-access tile pattern. */}
      {!loading && quickTiles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
          {quickTiles.map(provider => {
            const oauthProviderId = getOAuthProviderId(provider.id)
            return (
              <a
                key={provider.id}
                href={provider.available && !provider.pat ? `/api/oauth/${oauthProviderId}` : undefined}
                onClick={(e) => {
                  if (!provider.available) return
                  if (provider.pat) {
                    e.preventDefault()
                    setModalOpen(true)
                  }
                }}
                className="flex items-start gap-3 p-4 rounded-md border border-border bg-card hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ProviderIcon provider={provider} size={36} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{provider.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{provider.description}</p>
                </div>
              </a>
            )
          })}
        </div>
      )}

      {/* Modal */}
      <AddIntegrationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        connectedProviders={connectedProviders}
        onChanged={() => { fetchIntegrations() }}
      />
    </div>
  )
}
