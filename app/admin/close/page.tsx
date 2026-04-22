import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Target, Search } from 'lucide-react'
import ClientListSection, { type ClientRow } from '@/components/admin/ClientListSection'

export const metadata: Metadata = { title: 'Client Usage · Nexley Admin' }
export const dynamic = 'force-dynamic'

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
      .limit(500)
    all = (data ?? []) as ClientRow[]
  } catch {
    all = []
  }

  const filtered = search
    ? all.filter(c =>
        (c.name ?? '').toLowerCase().includes(search) ||
        c.slug.toLowerCase().includes(search)
      )
    : all

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
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      {/* Ambient background gradients */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-3xl pointer-events-none opacity-40"
        style={{ background: 'radial-gradient(circle, rgb(139 92 246 / 0.15) 0%, transparent 70%)' }}
      />

      {/* Top bar */}
      <div className="border-b border-border/50 relative">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
            Back to dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12 relative">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="inline-flex items-center justify-center w-11 h-11 rounded-2xl text-white relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
            >
              <Target size={20} strokeWidth={2.5} />
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight leading-none">Client Usage</h1>
              <p className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wider font-medium">Admin only · closing tool</p>
            </div>
          </div>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg">
            Pick any client to see their AI Employee performance. Trial clients shown first, ordered by urgency.
          </p>
        </div>

        {/* Search */}
        <form action="/admin/close" method="get" className="mb-10">
          <div
            className="flex items-center gap-3 rounded-xl border bg-card/50 backdrop-blur-sm px-4 py-3 transition-all focus-within:border-purple-500/60 focus-within:shadow-md focus-within:shadow-purple-500/5"
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
              <Link
                href="/admin/close"
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted/50 transition-colors"
              >
                Clear
              </Link>
            )}
          </div>
        </form>

        {/* Trial clients — urgent section */}
        <ClientListSection
          title="Trials"
          clients={trials}
          withTrialBadges
          trialStatusFor={(c) => trialStatus(c.trial_ends_at)}
        />

        {/* Other clients */}
        <ClientListSection
          title="All other clients"
          clients={others}
        />

        {/* Empty state */}
        {trials.length === 0 && others.length === 0 && (
          <div className="rounded-2xl border border-border/50 bg-card/50 px-6 py-16 text-center">
            <div
              className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
              style={{ background: 'rgb(139 92 246 / 0.1)', color: '#8B5CF6' }}
            >
              <Target size={20} />
            </div>
            <p className="text-lg font-semibold mb-1">
              {search ? 'No matches found' : 'No clients yet'}
            </p>
            <p className="text-sm text-muted-foreground">
              {search ? `Nothing matches "${search}". Try a different search.` : 'Clients will appear here once they sign up.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
