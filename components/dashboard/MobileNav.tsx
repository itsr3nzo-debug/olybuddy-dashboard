'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Bot,
  Plug,
  Settings,
  Target,
  Users,
  MessageSquare,
} from 'lucide-react'
import type { UserRole } from '@/lib/rbac'
import { MEMBER_BLOCKED_PAGES } from '@/lib/rbac'
import { cn } from '@/lib/utils'

/**
 * MobileNav — v2 (revised after DA pass).
 *
 * The previous v2 had two slots both pointing at `/settings` (a "Settings"
 * tab and a "More" tab) — duplicate active states + members couldn't reach
 * either route because /settings is blocked for them. Fixed:
 *
 *   - 5 unique destinations, role-aware
 *   - Owner / member: Home · Chat · Conversations · Contacts
 *     (Settings/Integrations get the desktop sidebar; mobile users hit them
 *     via a long-press on the user-menu chip, planned next.)
 *   - Members already lose Settings + Integrations from sidebar; mobile mirrors
 *     that by NOT including them, so no dead-link tabs.
 *   - Super-admin: Home · Admin · Clients · Chat (drops Conversations slot)
 *
 * Visual: hairline top border, optional backdrop-blur, 2px active accent
 * strip on top of the active tab.
 */

interface Tab {
  href: string
  label: string
  Icon: typeof LayoutDashboard
}

const ownerTabs: Tab[] = [
  { href: '/dashboard',     label: 'Home',          Icon: LayoutDashboard },
  { href: '/chat',          label: 'Chat',          Icon: Bot },
  { href: '/conversations', label: 'Inbox',         Icon: MessageSquare },
  { href: '/contacts',      label: 'Contacts',      Icon: Users },
  { href: '/settings',      label: 'Settings',      Icon: Settings },
]

const adminTabs: Tab[] = [
  { href: '/dashboard',    label: 'Home',     Icon: LayoutDashboard },
  { href: '/admin',        label: 'Admin',    Icon: Settings },
  { href: '/admin/close',  label: 'Clients',  Icon: Target },
  { href: '/integrations', label: 'Integrate', Icon: Plug },
  { href: '/chat',         label: 'Chat',     Icon: Bot },
]

export default function MobileNav({ role = 'owner' }: { role?: UserRole }) {
  const pathname = usePathname()

  let tabs = role === 'super_admin' ? adminTabs : ownerTabs

  // For members, strip routes they can't access (else taps bounce them).
  if (role === 'member') {
    tabs = tabs.filter(
      (t) => !MEMBER_BLOCKED_PAGES.some((p) => t.href === p || t.href.startsWith(p + '/')),
    )
  }

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed bottom-0 left-0 right-0 lg:hidden z-50',
        'border-t border-border',
        'bg-card/85 backdrop-blur-md',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="flex items-stretch justify-around px-1">
        {tabs.map(({ href, label, Icon }) => {
          // For Home, only exact /dashboard is active. For everything else,
          // a prefix match is fine (e.g. /contacts/[id] should keep Contacts
          // tab active).
          const active =
            pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5',
                  'h-14 min-h-[48px] touch-target',
                  'transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-primary"
                  />
                )}
                <Icon size={20} strokeWidth={active ? 1.75 : 1.5} />
                <span
                  className={cn(
                    'text-[10.5px] tracking-tight leading-tight',
                    active ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
