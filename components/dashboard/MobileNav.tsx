'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Bot, Plug, Users, Shield, Settings, Target } from 'lucide-react'
import type { UserRole } from '@/lib/rbac'

// Mobile bottom nav mirrors the desktop sidebar's simplified 6-item set
// (Dashboard / Chat / Integrations / Sender Roles / Agent trust / Settings).
// Sidebar is hidden on mobile (`hidden lg:block`), so this bar is the only
// persistent navigation — it must carry the same items the rail does or
// mobile users lose access to the kept pages.
const baseTabs = [
  { href: '/dashboard',             label: 'Home',         Icon: LayoutDashboard },
  { href: '/chat',                  label: 'Chat',         Icon: Bot },
  { href: '/integrations',          label: 'Integrations', Icon: Plug },
  { href: '/settings/sender-roles', label: 'Senders',      Icon: Users },
  { href: '/settings/agent-trust',  label: 'Trust',        Icon: Shield },
  { href: '/settings',              label: 'Settings',     Icon: Settings },
]

export default function MobileNav({ role = 'owner' }: { role?: UserRole }) {
  const pathname = usePathname()

  // Super-admins swap Settings for Client Usage in the last slot (Settings is
  // still reachable from inside Chat → profile menu, and Client Usage is the
  // day-to-day admin tool that deserves the nav slot on mobile).
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
