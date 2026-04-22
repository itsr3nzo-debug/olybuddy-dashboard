import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Clock, AlertCircle } from 'lucide-react'

export const metadata: Metadata = { title: 'Close · Nexley Admin' }
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

export default async function TrialCloseLandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const session = getUserSession(user)
  if (session.role !== 'super_admin') redirect('/dashboard')

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Fetch trial clients (any error returns empty — page still renders)
  let clients: Array<{
    id: string; name: string | null; slug: string;
    subscription_status: string; trial_ends_at: string | null;
  }> = []

  try {
    const { data } = await service
      .from('clients')
      .select('id, name, slug, subscription_status, trial_ends_at')
      .in('subscription_status', ['trial', 'ai-employee-trial'])
      .order('trial_ends_at', { ascending: true })
    clients = data ?? []
  } catch {
    clients = []
  }

  // Sort: expired first (most urgent to close), then ending-soonest
  const sorted = clients.slice().sort((a, b) => {
    const aEnd = a.trial_ends_at ? new Date(a.trial_ends_at).getTime() : Infinity
    const bEnd = b.trial_ends_at ? new Date(b.trial_ends_at).getTime() : Infinity
    return aEnd - bEnd
  })

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="border-b border-border/50">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link
            href="/admin/fleet"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={16} />
            Back to fleet
          </Link>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Close a trial</h1>
          <p className="text-base text-muted-foreground">
            Pick a client. Ask their day rate. Let the number close.
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-2xl border border-border/50 px-6 py-12 text-center">
            <Clock size={24} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-base font-medium">No active trials</p>
            <p className="text-sm text-muted-foreground mt-1">
              Clients will appear here when their trial starts.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sorted.map(c => {
              const status = trialStatus(c.trial_ends_at)
              return (
                <Link
                  key={c.id}
                  href={`/admin/close/${c.id}`}
                  className="group flex items-center justify-between rounded-xl border border-border/70 hover:border-purple-500/40 bg-card hover:bg-accent/30 transition-all px-5 py-4"
                >
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="text-base font-semibold truncate">
                      {c.name || c.slug}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.slug}</span>
                  </div>

                  <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
                        status.tone === 'expired'
                          ? 'bg-red-500/15 text-red-500 dark:text-red-400'
                          : status.tone === 'urgent'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      {status.tone === 'expired' && <AlertCircle size={12} />}
                      {status.label}
                    </span>
                    <ChevronRight
                      size={18}
                      className="text-muted-foreground group-hover:text-purple-500 transition-colors"
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
