'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Search, Plus, X, Mail, Calendar, Receipt, CreditCard,
  MessageSquare, Building, Plug, Calculator, FileText,
  BarChart, Users, Clock, Briefcase, Shield, Wallet
} from 'lucide-react'
import { PROVIDERS, CATEGORIES, getOAuthProviderId, type ProviderConfig } from '@/lib/integrations-config'

/* -- Provider icon mapping -- */

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  gmail: <Mail className="w-5 h-5" />,
  outlook: <Mail className="w-5 h-5" />,
  slack: <MessageSquare className="w-5 h-5" />,
  microsoft_teams: <MessageSquare className="w-5 h-5" />,
  google_calendar: <Calendar className="w-5 h-5" />,
  calendly: <Clock className="w-5 h-5" />,
  outlook_calendar: <Calendar className="w-5 h-5" />,
  xero: <Calculator className="w-5 h-5" />,
  quickbooks: <Calculator className="w-5 h-5" />,
  sage: <Calculator className="w-5 h-5" />,
  freeagent: <Calculator className="w-5 h-5" />,
  dext: <FileText className="w-5 h-5" />,
  hubdoc: <FileText className="w-5 h-5" />,
  ignition: <Briefcase className="w-5 h-5" />,
  brightmanager: <Briefcase className="w-5 h-5" />,
  pixie: <Briefcase className="w-5 h-5" />,
  taxcalc: <Shield className="w-5 h-5" />,
  iris: <Shield className="w-5 h-5" />,
  fathom: <BarChart className="w-5 h-5" />,
  spotlight: <BarChart className="w-5 h-5" />,
  hubspot: <Users className="w-5 h-5" />,
  stripe: <CreditCard className="w-5 h-5" />,
}

function getProviderIcon(providerId: string): React.ReactNode {
  return PROVIDER_ICONS[providerId] || <Plug className="w-5 h-5" />
}

/* -- Provider icons (colored) -- */

function ProviderIcon({ provider }: { provider: string }) {
  const config = PROVIDERS.find(p => p.id === provider)
  const colorClasses = config?.iconColor || 'bg-gray-100 text-gray-600'
  return (
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorClasses}`}>
      {getProviderIcon(provider)}
    </div>
  )
}

/* -- Connected integration row -- */

interface ConnectedIntegration {
  id: string
  provider: string
  status: string
  account_email: string | null
  account_name: string | null
  last_synced_at: string | null
  created_at: string
  error_message?: string | null
}

function ConnectedRow({ integration, onDisconnect }: { integration: ConnectedIntegration; onDisconnect: (id: string, provider: string) => void }) {
  const def = PROVIDERS.find(p => p.id === integration.provider)
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <ProviderIcon provider={integration.provider} />
          <div>
            <p className="font-medium text-gray-900 dark:text-white text-sm">{def?.name || integration.provider}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{integration.account_email || def?.description}</p>
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
          integration.status === 'connected' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' :
          integration.status === 'expired' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' :
          'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            integration.status === 'connected' ? 'bg-green-500' :
            integration.status === 'expired' ? 'bg-amber-500' : 'bg-red-500'
          }`} />
          {integration.status === 'connected' ? 'Active' : integration.status === 'expired' ? 'Expired' : 'Error'}
        </span>
      </td>
      <td className="py-4 px-4 text-sm text-gray-500 dark:text-gray-400">
        {integration.created_at ? new Date(integration.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '\u2014'}
      </td>
      <td className="py-4 px-4 text-right">
        <button
          onClick={() => onDisconnect(integration.id, integration.provider)}
          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
        >
          Disconnect
        </button>
      </td>
    </tr>
  )
}

/* -- Add integration modal -- */

function AddIntegrationModal({ open, onClose, connectedProviders }: { open: boolean; onClose: () => void; connectedProviders: Set<string> }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  if (!open) return null

  const filtered = PROVIDERS.filter(p => {
    if (category !== 'all' && p.category !== category) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add integration</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex h-[60vh]">
          {/* Left sidebar -- categories */}
          <div className="w-52 border-r border-gray-200 dark:border-gray-800 py-2 flex-shrink-0 overflow-y-auto">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  category === cat.id
                    ? 'text-gray-900 dark:text-white font-medium bg-gray-100 dark:bg-gray-800'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Right side -- search + grid */}
          <div className="flex-1 overflow-y-auto">
            {/* Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search integrations..."
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 gap-3 p-4">
              {filtered.map(provider => {
                const isConnected = connectedProviders.has(provider.id)
                const oauthProviderId = getOAuthProviderId(provider.id)
                return (
                  <a
                    key={provider.id}
                    href={provider.available && !isConnected ? `/api/oauth/${oauthProviderId}` : undefined}
                    className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      isConnected
                        ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 cursor-default'
                        : provider.available
                        ? 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md cursor-pointer'
                        : 'border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <ProviderIcon provider={provider.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</p>
                        {isConnected && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-[10px] font-semibold uppercase">Connected</span>
                        )}
                        {!provider.available && !isConnected && (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 rounded text-[10px] font-semibold uppercase">Coming Soon</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{provider.description}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
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

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('integrations')
        .select('id, provider, status, account_email, account_name, last_synced_at, created_at, error_message')
        .order('created_at', { ascending: false })

      setIntegrations(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const connectedProviders = new Set(integrations.filter(i => i.status === 'connected').map(i => i.provider))

  const handleDisconnect = async (id: string, provider: string) => {
    if (!confirm('Disconnect this integration? Your AI Employee will no longer have access.')) return
    // Use the OAuth provider ID for the disconnect endpoint (e.g., gmail -> google)
    const oauthProviderId = getOAuthProviderId(provider)
    const res = await fetch(`/api/oauth/${oauthProviderId}/disconnect`, { method: 'POST' })
    if (res.ok) {
      // For Google, remove both gmail + google_calendar rows
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Success Banner */}
      {success && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
          <p className="text-sm text-emerald-400">{success}</p>
          <button onClick={() => setSuccess('')} className="text-emerald-400 hover:text-emerald-300 text-xs">Dismiss</button>
        </div>
      )}

      {/* Expired-token re-link banner */}
      {integrations.some(i => i.status === 'expired' || i.status === 'error') && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-sm text-amber-300 font-medium">Some integrations need re-authorising</p>
          <ul className="mt-1 text-xs text-amber-300/80 space-y-0.5">
            {integrations.filter(i => i.status === 'expired' || i.status === 'error').map(i => (
              <li key={i.id} className="flex items-center justify-between">
                <span>· {i.provider.replace(/_/g, ' ')} {i.error_message ? `\u2014 ${i.error_message.slice(0, 80)}` : ''}</span>
                <a href={`/api/oauth/${getOAuthProviderId(i.provider)}`}
                   className="ml-3 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px]">
                  Reconnect
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-between">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 text-xs">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Integrations</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Connect your accounts. Your AI Employee uses them automatically.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add integration
        </button>
      </div>

      {/* Search */}
      {integrations.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search integrations..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      )}

      {/* Table or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 dark:border-gray-600 dark:border-t-white rounded-full animate-spin" />
        </div>
      ) : integrations.length > 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date connected</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(integration => (
                <ConnectedRow key={integration.id} integration={integration} onDisconnect={handleDisconnect} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <Plug className="w-7 h-7 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No integrations configured</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
            Connect your accounts so your AI Employee can read emails, manage your calendar, and handle invoicing automatically.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add integration
          </button>
        </div>
      )}

      {/* Modal */}
      <AddIntegrationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        connectedProviders={connectedProviders}
      />
    </div>
  )
}
