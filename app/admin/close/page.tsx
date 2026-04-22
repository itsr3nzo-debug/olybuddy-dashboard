import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, AlertCircle, Target, CheckCircle2, Search } from 'lucide-react'

export const metadata: Metadata = { title: 'Client Usage · Nexley Admin' }
export const dynamic = 'force-dynamic'

interface ClientRow {
  id: string
  name: string | null
  slug: string
  subscription_status: string | null
  trial_ends_at: string | null
}

function trialStatus(endDate: string | null): { label: string; tone: 'expired' | 'urgent' | 'normal' } {
  if (!endDate) return { label: 'No end date', tone: 'normal' }
  const diff = new Date(endDate).getTime() - Date.now()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: 'expired' }
  if (days === 0) return { label: 'Expires today', tone: 'urgent' }
  if (days === 1) return { label: '1 day left', tone: 'urgent' }
  return { label: `${days} days left`, tone: 'normal' }
}

export default async function ClientUsageLandingPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const session = getUserSession(user)
  if (session.role !== 'super_admin') redirect('/dashboard')

  const params = await searchParams
  const search = (params.q ?? '').toLowerCase().trim()

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let all: ClientRow[] = []
  try {
    const { data } = await service
      .from('clients')
      .select('id, name, slug, subscription_status, trial_ends_at')
      .order('name', { ascending: true })
    all = (data ?? []) as ClientRow[]
  } catch {
    all = []
  }

  // Filter by search if present
  const filtered = search
    ? all.filter(c =>
        (c.name ?? '').toLowerCase().includes(search) ||
        c.slug.toLowerCase().includes(search)
      )
    : all

  // Split into groups: trials (urgent closing) and everything else
  const trials = filtered
    .filter(c => c.subscription_status === 'trial' || c.subscription_status === 'ai-employee-trial')
    .sort((a, b) => {
      const aEnd = a.trial_ends_at ? new Date(a.trial_ends_at).getTime() : Infinity
      const bEnd = b.trial_ends_at ? new Date(b.trial_ends_at).getTime() : Infinity
      return aEnd - bEnd
    })

  const others = filtered
    .filter(c => c.subscription_status !== 'trial' && c.subscription_status !== 'ai-employee-trial')
    .sort((a, b) => (a.name ?? a.slug).localeCompare(b.name ?? b.slug))

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
            >
              <Target size={16} />
            </div>
            <h1 className="text-3xl font-bold">Client Usage</h1>
          </div>
          <p className="text-base text-muted-foreground">
            Pick any client to see their AI Employee usage. Trial clients shown first.
          </p>
        </div>

        {/* Search */}
        <form action="/admin/close" method="get" className="mb-8">
          <div
            className="flex items-center gap-3 rounded-xl border px-4 py-3"
            style={{ borderColor: 'rgb(var(--border))' }}
          >
            <Search size={16} className="text-muted-foreground flex-shrink-0" />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search by name or slug…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            {search && (
              <Link href="/admin/close" className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            )}
          </div>
        </form>

        {/* Trial clients — urgent section */}
        {trials.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Trials ({trials.length})
              </h2>
              <span className="h-px flex-1 bg-border/50" />
            </div>
            <div className="space-y-2">
              {trials.map(c => {
                const status = trialStatus(c.trial_ends_at)
                return (
                  <ClientRowLink key={c.id} client={c} trialBadge={{ label: status.label, tone: status.tone }} />
                )
              })}
            </div>
          </div>
        )}

        {/* Other clients */}
        {others.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                All other clients ({others.length})
              </h2>
              <span className="h-px flex-1 bg-border/50" />
            </div>
            <div className="space-y-2">
              {others.map(c => (
                <ClientRowLink key={c.id} client={c} />
              ))}
            </div>
          </div>
        )}

        {/* Empty states */}
        {trials.length === 0 && others.length === 0 && (
          <div className="rounded-2xl border border-border/50 px-6 py-12 text-center">
            <Target size={24} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-base font-medium">
              {search ? 'No matches found' : 'No clients yet'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? `Nothing matches "${search}". Try a different search.` : 'Clients will appear here once they sign up.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ClientRowLink({ client, trialBadge }: {
  client: ClientRow
  trialBadge?: { label: string; tone: 'expired' | 'urgent' | 'normal' }
}) {
  return (
    <Link
      href={`/admin/close/${client.id}`}
      className="group flex items-center justify-between rounded-xl border border-border/70 hover:border-purple-500/40 bg-card hover:bg-accent/30 transition-all px-5 py-4"
    >
      <div className="flex flex-col min-w-0 gap-0.5">
        <span className="text-base font-semibold truncate">
          {client.name || client.slug}
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{client.slug}</span>
          <span className="opacity-40">·</span>
          <span className="capitalize">{client.subscription_status ?? 'unknown'}</span>
        </span>
      </div>

      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        {trialBadge && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
              trialBadge.tone === 'expired'
                ? 'bg-red-500/15 text-red-500 dark:text-red-400'
                : trialBadge.tone === 'urgent'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'bg-muted/50 text-muted-foreground'
            }`}
          >
            {trialBadge.tone === 'expired' && <AlertCircle size={12} />}
            {trialBadge.tone === 'normal' && <CheckCircle2 size={12} />}
            {trialBadge.label}
          </span>
        )}
        <ChevronRight
          size={18}
          className="text-muted-foreground group-hover:text-purple-500 transition-colors"
        />
      </div>
    </Link>
  )
}
