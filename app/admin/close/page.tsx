import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getUserSession } from '@/lib/rbac'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Close · Nexley Admin' }
export const dynamic = 'force-dynamic'

function daysUntil(dateStr: string | null): { label: string; urgent: boolean; expired: boolean } {
  if (!dateStr) return { label: 'No end date', urgent: false, expired: false }
  const diff = new Date(dateStr).getTime() - Date.now()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, urgent: true, expired: true }
  if (days === 0) return { label: 'Expires today', urgent: true, expired: false }
  if (days === 1) return { label: 'Expires tomorrow', urgent: true, expired: false }
  return { label: `Ends in ${days} days`, urgent: false, expired: false }
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

  // Fetch trial clients — order by trial_ends_at ascending so expiring-soonest is first
  const { data: clients } = await service
    .from('clients')
    .select('id, name, slug, subscription_status, trial_ends_at, created_at')
    .in('subscription_status', ['trial', 'ai-employee-trial'])
    .order('trial_ends_at', { ascending: true, nullsFirst: false })

  const rows = clients ?? []

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">Close a trial</h1>
          <p className="text-sm text-muted-foreground">
            Pick a client, ask their day rate, let the number close.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-border/50 px-5 py-8 text-center text-sm text-muted-foreground">
            No clients currently on trial.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(c => {
              const { label, urgent, expired } = daysUntil(c.trial_ends_at)
              return (
                <Link
                  key={c.id}
                  href={`/admin/close/${c.id}`}
                  className="flex items-center justify-between rounded-xl border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors px-5 py-4"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-foreground truncate">
                      {c.name || c.slug}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">{c.slug}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        expired
                          ? 'bg-red-500/15 text-red-400'
                          : urgent
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      {label}
                    </span>
                    <span className="text-sm text-muted-foreground">Close →</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-border/30">
          <Link href="/admin/fleet" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Back to fleet
          </Link>
        </div>
      </div>
    </div>
  )
}
