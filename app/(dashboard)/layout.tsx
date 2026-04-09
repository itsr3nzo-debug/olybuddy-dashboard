import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/dashboard/Sidebar'
import MobileNav from '@/components/dashboard/MobileNav'
import CommandPalette from '@/components/shared/CommandPalette'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  let businessName = 'My Business'

  if (clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', clientId)
      .single()
    if (client) businessName = client.name
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar businessName={businessName} />
      </div>

      {/* Main content */}
      <main className="flex-1 lg:ml-60 min-h-screen p-4 sm:p-6 lg:p-8 overflow-auto pb-24 lg:pb-8 transition-[margin] duration-300">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <MobileNav />

      {/* Global command palette (Cmd+K) */}
      <CommandPalette />
    </div>
  )
}
