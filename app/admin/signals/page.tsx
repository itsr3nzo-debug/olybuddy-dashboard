import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Signals · Nexley Admin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface SignalRow {
  id: number
  client_id: string
  signal_id: string
  provider: string
  signal_type: string
  summary: string
  urgency: 'emergency' | 'urgent' | 'normal' | 'low' | string
  status: 'new' | 'owner_approved' | 'owner_rejected' | 'auto_acted' | 'auto_skipped' | 'expired' | 'failed' | string
  source_ref: string | null
  detected_at_iso: string
  acted_at_iso: string | null
  created_at: string
}

function ageMinutes(ts: string): number {
  return Math.floor((Date.now() - new Date(ts).getTime()) / 60_000)
}

function ageLabel(ts: string): string {
  const m = ageMinutes(ts)
  if (m < 60) return `${m}m ago`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ago`
  return `${Math.floor(m / (24 * 60))}d ago`
}

function urgencyPill(u: string): string {
  switch (u) {
    case 'emergency': return 'bg-red-500/20 text-red-300 border-red-500/40'
    case 'urgent':    return 'bg-orange-500/20 text-orange-300 border-orange-500/40'
    case 'normal':    return 'bg-sky-500/20 text-sky-300 border-sky-500/40'
    case 'low':       return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
    default:          return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
  }
}

function statusPill(s: string): string {
  switch (s) {
    case 'new':              return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
    case 'auto_acted':       return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'owner_approved':   return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'owner_rejected':   return 'bg-slate-500/20 text-slate-400 border-slate-500/40'
    case 'auto_skipped':     return 'bg-slate-500/20 text-slate-400 border-slate-500/40'
    case 'failed':           return 'bg-red-500/20 text-red-300 border-red-500/40'
    case 'expired':          return 'bg-slate-500/20 text-slate-400 border-slate-500/40'
    default:                 return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
  }
}

function prettifyType(t: string): string {
  return t.replace(/^(fergus|xero|owner|review)_/, '').replace(/_/g, ' ')
}

export default async function SignalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const session = getUserSession(user)
  if (session.role !== 'super_admin') redirect('/dashboard')

  const sb = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // Pull last 200 signals across all clients
  const { data: signalsData } = await sb
    .from('integration_signals')
    .select('id, client_id, signal_id, provider, signal_type, summary, urgency, status, source_ref, detected_at_iso, acted_at_iso, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const signals = (signalsData ?? []) as SignalRow[]

  // Resolve client names
  const clientIds = [...new Set(signals.map(s => s.client_id))]
  const { data: clientsData } = await sb
    .from('clients')
    .select('id, name, slug')
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
  const clientLookup = new Map<string, { name: string; slug: string }>()
  for (const c of clientsData ?? []) {
    clientLookup.set((c as { id: string }).id, c as { name: string; slug: string })
  }

  // Aggregate stats
  const byStatus = { new: 0, auto_acted: 0, owner_approved: 0, failed: 0, other: 0 }
  const byClient: Record<string, { total: number; unacted: number; name: string }> = {}
  for (const s of signals) {
    if (s.status === 'new') byStatus.new++
    else if (s.status === 'auto_acted') byStatus.auto_acted++
    else if (s.status === 'owner_approved') byStatus.owner_approved++
    else if (s.status === 'failed') byStatus.failed++
    else byStatus.other++
    const clientName = clientLookup.get(s.client_id)?.name ?? s.client_id.slice(0, 8)
    if (!byClient[s.client_id]) byClient[s.client_id] = { total: 0, unacted: 0, name: clientName }
    byClient[s.client_id].total++
    if (s.status === 'new') byClient[s.client_id].unacted++
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] text-slate-200 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Signals</h1>
            <p className="text-sm text-slate-400 mt-1">Every briefing, chase, and guard the platform has emitted. Newest first, last 200.</p>
          </div>
          <Link href="/admin/fleet" className="text-sm text-indigo-400 hover:text-indigo-300">← Fleet</Link>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatCard label="New (unacted)" value={byStatus.new} color="yellow" />
          <StatCard label="Auto-acted" value={byStatus.auto_acted} color="emerald" />
          <StatCard label="Owner approved" value={byStatus.owner_approved} color="emerald" />
          <StatCard label="Failed" value={byStatus.failed} color="red" />
          <StatCard label="Total (200 recent)" value={signals.length} color="slate" />
        </div>

        {/* Per-client summary */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">By client</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byClient)
              .sort((a, b) => b[1].unacted - a[1].unacted)
              .map(([cid, stats]) => (
                <div key={cid} className="px-3 py-2 rounded-lg bg-slate-800/60 border border-white/5 text-xs">
                  <span className="text-white font-medium">{stats.name}</span>
                  <span className="text-slate-400 ml-2">{stats.total} total</span>
                  {stats.unacted > 0 && <span className="text-yellow-300 ml-2">• {stats.unacted} unacted</span>}
                </div>
              ))}
          </div>
        </div>

        {/* Signal table */}
        <div className="rounded-xl bg-slate-900/60 border border-white/5 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/80 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Client</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Urgency</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {signals.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No signals yet.</td></tr>
              )}
              {signals.map(s => {
                const client = clientLookup.get(s.client_id)
                return (
                  <tr key={s.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{ageLabel(s.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{client?.name ?? <span className="text-slate-500">{s.client_id.slice(0, 8)}</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-300">{prettifyType(s.signal_type)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide ${urgencyPill(s.urgency)}`}>{s.urgency}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide ${statusPill(s.status)}`}>{s.status.replace('_', ' ')}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-300 max-w-md truncate" title={s.summary}>{s.summary.split('\n')[0]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: 'yellow' | 'emerald' | 'red' | 'slate' }) {
  const bg = {
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
    emerald: 'bg-emerald-500/10 border-emerald-500/30',
    red: 'bg-red-500/10 border-red-500/30',
    slate: 'bg-slate-500/10 border-slate-500/30',
  }[color]
  const fg = {
    yellow: 'text-yellow-300',
    emerald: 'text-emerald-300',
    red: 'text-red-300',
    slate: 'text-slate-300',
  }[color]
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${fg}`}>{value}</div>
    </div>
  )
}
