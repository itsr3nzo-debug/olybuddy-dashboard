'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Kanban, MessageSquare, Calendar, ScrollText, Target, Plug } from 'lucide-react'
import type { UserRole } from '@/lib/rbac'

// Mobile bottom nav. Sidebar is hidden on mobile (lg:block), so without
// an Integrations tab here, mobile owners had no way to reach /integrations
// except via the one-time "Connect now" banner on the dashboard — meaning
// once it disappeared they were locked out of managing connections.
const baseTabs = [
  { href: '/dashboard',      label: 'Home',         Icon: LayoutDashboard },
  { href: '/pipeline',       label: 'Pipeline',     Icon: Kanban },
  { href: '/conversations',  label: 'Inbox',        Icon: MessageSquare },
  { href: '/calls',          label: 'Activity',     Icon: ScrollText },
  { href: '/integrations',   label: 'Integrations', Icon: Plug },
  { href: '/calendar',       label: 'Calendar',     Icon: Calendar },
]

export default function MobileNav({ role = 'owner' }: { role?: UserRole }) {
  const pathname = usePathname()

  // Super-admins get Client Usage instead of Calendar on mobile (closer-to-hand
  // tool). Keep the first 5 owner tabs (Home, Pipeline, Inbox, Activity,
  // Integrations) and swap Calendar for Usage in the last slot.
  const tabs = role === 'super_admin'
    ? [...baseTabs.slice(0, 5), { href: '/admin/close', label: 'Usage', Icon: Target }]
    : baseTabs

  return (
    <nav className="fixed bottom-0 left-0 right-0 lg:hidden z-50 border-t border-border bg-card-bg/95 backdrop-blur-sm">
      <div className="flex items-center justify-around px-2">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={`flex flex-col items-center gap-0.5 py-2 px-3 touch-target transition-colors ${
                active ? 'text-brand-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
