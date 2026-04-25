import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserSession } from '@/lib/rbac'
import { RoleProvider } from '@/lib/role-context'
import Sidebar from '@/components/dashboard/Sidebar'
import MobileNav from '@/components/dashboard/MobileNav'
import CommandPalette from '@/components/shared/CommandPalette'
import TrialBanner from '@/components/dashboard/TrialBanner'
import ProvisioningBanner from '@/components/dashboard/ProvisioningBanner'
import EmailVerificationBanner from '@/components/dashboard/EmailVerificationBanner'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import ChatLauncher from '@/components/chat/ChatLauncher'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const session = getUserSession(user)
  let businessName = 'My Business'
  let onboardingDone = true
  let subscriptionStatus = 'active'
  let trialEndsAt: string | null = null
  let emailVerifiedAt: string | null = null
  let clientEmail: string | null = null

  let launcherOwner: string | undefined;
  if (session.role === 'super_admin' && !session.clientId) {
    businessName = 'Nexley AI Admin'
  } else if (session.clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('name, onboarding_completed, subscription_status, trial_ends_at, contact_name, email, email_verified_at')
      .eq('id', session.clientId)
      .single()
    if (client) {
      businessName = client.name
      onboardingDone = client.onboarding_completed ?? true
      subscriptionStatus = client.subscription_status ?? 'active'
      trialEndsAt = client.trial_ends_at ?? null
      launcherOwner = (client as { contact_name?: string }).contact_name
      emailVerifiedAt = (client as { email_verified_at?: string | null }).email_verified_at ?? null
      clientEmail = (client as { email?: string }).email ?? null
    }
  }

  // Onboarding gate lives in middleware.ts (runs before render → no flicker).
  // This layout just renders. `onboardingDone` is still read above because
  // the page may be /onboarding itself (which is allowed for unfinished users).

  return (
    <RoleProvider session={session}>
      <div className="flex min-h-screen bg-background">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <Sidebar businessName={businessName} role={session.role} />
        </div>

        {/* Main content */}
        <main className="flex-1 lg:ml-60 min-h-screen p-4 sm:p-6 lg:p-8 overflow-auto pb-24 lg:pb-8 transition-[margin] duration-300">
          <TrialBanner trialEndsAt={trialEndsAt} subscriptionStatus={subscriptionStatus} />
          {session.role !== 'super_admin' && session.clientId && <ProvisioningBanner />}
          {session.role !== 'super_admin' && session.clientId && !emailVerifiedAt && clientEmail && (
            <EmailVerificationBanner email={clientEmail} />
          )}
          <Breadcrumb />
          {children}
        </main>

        {/* Mobile bottom nav */}
        <MobileNav role={session.role} />

        {/* Global command palette (Cmd+K) */}
        <CommandPalette />

        {/* Global AI chat launcher (Cmd+J) — available on every tab */}
        {session.clientId && (
          <ChatLauncher
            clientId={session.clientId}
            clientName={businessName}
            userEmail={session.email}
            ownerName={launcherOwner}
          />
        )}
      </div>
    </RoleProvider>
  )
}
