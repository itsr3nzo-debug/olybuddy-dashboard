import type { Metadata } from 'next'
import { requireRole } from '@/lib/rbac-guard'
import { getSupabase } from '@/lib/supabase'
import Link from 'next/link'
import { Users, Phone, TrendingUp, Calendar, Target, ChevronRight } from 'lucide-react'
import { DeployButton, MarkLiveButton } from '@/components/admin/DeployActions'

export const metadata: Metadata = { title: 'Admin | Nexley AI' }

const VPS_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-zinc-800/50 text-zinc-400',
  provisioning: 'bg-blue-900/30 text-blue-400',
  deploying: 'bg-amber-900/30 text-amber-400',
  awaiting_pairing: 'bg-purple-900/30 text-purple-400',
  live: 'bg-green-900/30 text-green-400',
  error: 'bg-red-900/30 text-red-400',
}

function VpsBadge({ status }: { status?: string | null }) {
  const label = status ?? 'pending'
  const style = VPS_STATUS_STYLES[label] ?? VPS_STATUS_STYLES.pending
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${style}`}>
      {label.replace('_', ' ')}
    </span>
  )
}

export default async function AdminPage() {
  await requireRole('super_admin')

  const supabase = getSupabase()

  // Parallel fetch all admin data
  const [clientsRes, contactsRes, callsRes, oppsRes] = await Promise.all([
    supabase.from('clients').select('id, name, slug, email, industry, subscription_status, subscription_plan, health_score, vps_status, created_at').order('created_at', { ascending: false }),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('call_logs').select('id', { count: 'exact', head: true }),
    supabase.from('opportunities').select('id', { count: 'exact', head: true }),
  ])
  const clients = clientsRes.data
  const totalContacts = contactsRes.count
  const totalCalls = callsRes.count
  const totalOpportunities = oppsRes.count

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage all Nexley AI clients</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        <Link
          href="/admin/close"
          className="group flex items-center justify-between rounded-xl border p-5 transition-all hover:border-purple-500/60 hover:shadow-md hover:shadow-purple-500/10"
          style={{
            background: 'linear-gradient(135deg, rgb(139 92 246 / 0.08) 0%, rgb(99 102 241 / 0.04) 100%)',
            borderColor: 'rgb(139 92 246 / 0.25)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-white"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
            >
              <Target size={18} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-base font-semibold">Client Usage</p>
              <p className="text-xs text-muted-foreground">See AI activity + close trials</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-muted-foreground group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all" />
        </Link>
        <Link
          href="/admin/fleet"
          className="group flex items-center justify-between rounded-xl border p-5 transition-all hover:border-border hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-muted text-foreground">
              <Users size={18} strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-base font-semibold">Fleet</p>
              <p className="text-xs text-muted-foreground">VPS health · provisioning</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-muted-foreground group-hover:translate-x-0.5 transition-all" />
        </Link>
      </div>

      {/* Global stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Users size={14} />
            <span className="text-xs font-medium">Clients</span>
          </div>
          <p className="text-2xl font-bold">{clients?.length ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Phone size={14} />
            <span className="text-xs font-medium">Total Calls</span>
          </div>
          <p className="text-2xl font-bold">{totalCalls ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp size={14} />
            <span className="text-xs font-medium">Opportunities</span>
          </div>
          <p className="text-2xl font-bold">{totalOpportunities ?? 0}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Calendar size={14} />
            <span className="text-xs font-medium">Contacts</span>
          </div>
          <p className="text-2xl font-bold">{totalContacts ?? 0}</p>
        </div>
      </div>

      {/* Client table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Industry</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Health</th>
              <th className="px-4 py-3 font-medium">VPS</th>
              <th className="px-4 py-3 font-medium">Actions</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {clients?.map(client => (
              <tr key={client.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{client.email}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{client.industry}</td>
                <td className="px-4 py-3 text-sm">{client.subscription_plan}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    client.subscription_status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    client.subscription_status === 'trial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {client.subscription_status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium">{client.health_score ?? '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <VpsBadge status={client.vps_status} />
                </td>
                <td className="px-4 py-3">
                  {(!client.vps_status || client.vps_status === 'pending') && (
                    <DeployButton clientId={client.id} />
                  )}
                  {client.vps_status === 'awaiting_pairing' && (
                    <MarkLiveButton clientId={client.id} />
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/dashboard?as_client=${client.id}`}
                    className="text-xs text-brand-primary hover:underline font-medium"
                  >
                    View as Client
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
