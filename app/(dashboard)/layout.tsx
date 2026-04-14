import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserSession } from '@/lib/rbac'
import { RoleProvider } from '@/lib/role-context'
import Sidebar from '@/components/dashboard/Sidebar'
import MobileNav from '@/components/dashboard/MobileNav'
import CommandPalette from '@/components/shared/CommandPalette'
import OnboardingRedirect from '@/components/shared/OnboardingRedirect'
import TrialBanner from '@/components/dashboard/TrialBanner'
import { getSupabase } from '@/lib/supabase'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const session = getUserSession(user)
  let businessName = 'My Business'
  let onboardingDone = true
  let subscriptionStatus = 'active'
  let trialEndsAt: string | null = null

  if (session.role === 'super_admin' && !session.clientId) {
    businessName = 'Nexley AI Admin'
  } else if (session.clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('name, onboarding_completed, subscription_status, trial_ends_at')
      .eq('id', session.clientId)
      .single()
    if (client) {
      businessName = client.name
      onboardingDone = client.onboarding_completed ?? true
      subscriptionStatus = client.subscription_status ?? 'active'
      trialEndsAt = client.trial_ends_at ?? null
    }
  }

  return (
    <RoleProvider session={session}>
      {/* Redirect to onboarding if not completed (skip for super_admin) */}
      {session.role !== 'super_admin' && <OnboardingRedirect done={onboardingDone} />}

      <div className="flex min-h-screen bg-background">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <Sidebar businessName={businessName} role={session.role} />
        </div>

        {/* Main content */}
        <main className="flex-1 lg:ml-60 min-h-screen p-4 sm:p-6 lg:p-8 overflow-auto pb-24 lg:pb-8 transition-[margin] duration-300">
          <TrialBanner trialEndsAt={trialEndsAt} subscriptionStatus={subscriptionStatus} />
          {children}
        </main>

        {/* Mobile bottom nav */}
        <MobileNav role={session.role} />

        {/* Global command palette (Cmd+K) */}
        <CommandPalette />
      </div>
    </RoleProvider>
  )
}
