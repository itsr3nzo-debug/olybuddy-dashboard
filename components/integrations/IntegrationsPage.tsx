'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Plus, X, Mail, Calendar, Receipt, CreditCard, Share2, MessageSquare, Building, Plug } from 'lucide-react'

/* ── Integration definitions ─────────────── */

interface IntegrationDef {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  category: string
  available: boolean
}

const CATEGORIES = [
  { id: 'all', label: 'All integrations' },
  { id: 'communication', label: 'Communication' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'payments', label: 'Payments' },
  { id: 'social', label: 'Social Media' },
  { id: 'crm', label: 'CRM' },
]

const INTEGRATIONS: IntegrationDef[] = [
  { id: 'gmail', name: 'Gmail', description: 'Read and send emails on your behalf', icon: <Mail className="w-5 h-5" />, category: 'communication', available: true },
  { id: 'google_calendar', name: 'Google Calendar', description: 'Two-way appointment sync', icon: <Calendar className="w-5 h-5" />, category: 'scheduling', available: true },
  { id: 'outlook', name: 'Outlook / Microsoft 365', description: 'Email and calendar integration', icon: <Mail className="w-5 h-5" />, category: 'communication', available: false },
  { id: 'xero', name: 'Xero', description: 'Invoicing, expenses, and accounting', icon: <Receipt className="w-5 h-5" />, category: 'accounting', available: true },
  { id: 'quickbooks', name: 'QuickBooks', description: 'Accounting and payroll management', icon: <Receipt className="w-5 h-5" />, category: 'accounting', available: false },
  { id: 'stripe', name: 'Stripe', description: 'Payment links and subscription billing', icon: <CreditCard className="w-5 h-5" />, category: 'payments', available: true },
  { id: 'facebook', name: 'Facebook', description: 'Page messages and social posts', icon: <Share2 className="w-5 h-5" />, category: 'social', available: false },
  { id: 'instagram', name: 'Instagram', description: 'DMs and content management', icon: <Share2 className="w-5 h-5" />, category: 'social', available: false },
  { id: 'hubspot', name: 'HubSpot', description: 'Marketing, sales, and service platform', icon: <Building className="w-5 h-5" />, category: 'crm', available: false },
  { id: 'whatsapp_business', name: 'WhatsApp Business API', description: 'Official business messaging', icon: <MessageSquare className="w-5 h-5" />, category: 'communication', available: false },
]

/* ── Provider icons (colored) ─────────────── */

function ProviderIcon({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    gmail: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    google_calendar: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    outlook: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    xero: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400',
    quickbooks: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
    stripe: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    facebook: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    instagram: 'bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400',
    hubspot: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400',
    whatsapp_business: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  }
  const def = INTEGRATIONS.find(i => i.id === provider)
  return (
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[provider] || 'bg-gray-100 text-gray-600'}`}>
      {def?.icon || <Plug className="w-5 h-5" />}
    </div>
  )
}

/* ── Connected integration row ─────────────── */

interface ConnectedIntegration {
  id: string
  provider: string
  status: string
  account_email: string | null
  account_name: string | null
  last_synced_at: string | null
  created_at: string
}

function ConnectedRow({ integration, onDisconnect }: { integration: ConnectedIntegration; onDisconnect: (id: string) => void }) {
  const def = INTEGRATIONS.find(i => i.id === integration.provider)
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
        {integration.created_at ? new Date(integration.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
      </td>
      <td className="py-4 px-4 text-right">
        <button
          onClick={() => onDisconnect(integration.id)}
          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium transition-colors"
        >
          Disconnect
        </button>
      </td>
    </tr>
  )
}

/* ── Add integration modal ─────────────── */

function AddIntegrationModal({ open, onClose, connectedProviders }: { open: boolean; onClose: () => void; connectedProviders: Set<string> }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  if (!open) return null

  const filtered = INTEGRATIONS.filter(i => {
    if (category !== 'all' && i.category !== category) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
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
          {/* Left sidebar — categories */}
          <div className="w-52 border-r border-gray-200 dark:border-gray-800 py-2 flex-shrink-0">
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

          {/* Right side — search + grid */}
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
              {filtered.map(integration => {
                const isConnected = connectedProviders.has(integration.id)
                return (
                  <a
                    key={integration.id}
                    href={integration.available && !isConnected ? `/api/oauth/${integration.id.includes('google') ? 'google' : integration.id}` : undefined}
                    className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${
                      isConnected
                        ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 cursor-default'
                        : integration.available
                        ? 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md cursor-pointer'
                        : 'border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <ProviderIcon provider={integration.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{integration.name}</p>
                        {isConnected && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-[10px] font-semibold uppercase">Connected</span>
                        )}
                        {!integration.available && !isConnected && (
                          <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 rounded text-[10px] font-semibold uppercase">Soon</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{integration.description}</p>
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

/* ── Main page ─────────────── */

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<ConnectedIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('integrations')
        .select('id, provider, status, account_email, account_name, last_synced_at, created_at')
        .order('created_at', { ascending: false })

      setIntegrations(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const connectedProviders = new Set(integrations.filter(i => i.status === 'connected').map(i => i.provider))

  const handleDisconnect = async (id: string) => {
    if (!confirm('Disconnect this integration? Your AI Employee will no longer have access.')) return
    const supabase = createClient()
    await supabase.from('integrations').update({ status: 'disconnected', access_token_enc: null, refresh_token_enc: null }).eq('id', id)
    setIntegrations(prev => prev.filter(i => i.id !== id))
  }

  const filtered = integrations.filter(i => {
    if (!search) return true
    const def = INTEGRATIONS.find(d => d.id === i.provider)
    return def?.name.toLowerCase().includes(search.toLowerCase()) || i.account_email?.toLowerCase().includes(search.toLowerCase())
  })

  return (
    <div className="p-6 max-w-5xl mx-auto">
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
