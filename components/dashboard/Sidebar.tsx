'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sparkles, LayoutDashboard, Settings, LogOut, Sun, Moon, PanelLeftClose, PanelLeft, Plug, Shield, Users, Bot, Target, CreditCard } from 'lucide-react'
import type { UserRole } from '@/lib/rbac'
import { MEMBER_BLOCKED_PAGES } from '@/lib/rbac'

// Sidebar nav trimmed from 16 → 6 items (owner/member) and 18 → 8 items
// (super_admin). See docs note in `/app/(dashboard)/settings/page.tsx` for
// why each cut item is still reachable via the Settings → Tools grid.
// Every removed route still exists — only its visibility in the rail changed.
const allNavItems = [
  { href: '/dashboard',             label: 'Dashboard',    Icon: LayoutDashboard },
  { href: '/chat',                  label: 'Chat',         Icon: Bot },
  { href: '/integrations',          label: 'Integrations', Icon: Plug },
  { href: '/settings/sender-roles', label: 'Sender Roles', Icon: Users },
  { href: '/settings/agent-trust',  label: 'Agent trust',  Icon: Shield },
  { href: '/settings/billing',      label: 'Billing',      Icon: CreditCard },
  { href: '/settings',              label: 'Settings',     Icon: Settings },
]

function getNavItems(role: UserRole) {
  let items = allNavItems
  if (role === 'member') {
    // Match the page-level access check (which treats /settings/foo as blocked
    // when /settings is in the list). Strict equality here would show links
    // that 307-redirect away when clicked — ugly for members.
    items = items.filter(item =>
      !MEMBER_BLOCKED_PAGES.some(p => item.href === p || item.href.startsWith(p + '/'))
    )
  }
  if (role === 'super_admin') {
    items = [
      { href: '/admin', label: 'Admin', Icon: Shield },
      { href: '/admin/close', label: 'Client Usage', Icon: Target },
      ...items,
    ]
  }
  return items
}

export default function Sidebar({ businessName, role = 'owner' }: { businessName?: string; role?: UserRole }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)
  // `mounted` guards against SSR/CSR hydration mismatch in the theme toggle.
  // next-themes reads from localStorage on the client but the server render has
  // no access to that, so the initial Sun/Moon icon differs between server and
  // client HTML. Rendering a neutral placeholder until mounted fixes the
  // "Hydration failed because the server rendered HTML didn't match the client"
  // error that was firing on every page load.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
    setMounted(true)
  }, [])

  function toggleCollapse() {
    setCollapsed(prev => {
      localStorage.setItem('sidebar-collapsed', String(!prev))
      return !prev
    })
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className={`flex flex-col h-screen fixed left-0 top-0 z-40 border-r border-sidebar-border bg-sidebar transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}
    >
      {/* Logo / Business Name */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-border min-h-[60px]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-sidebar-primary">
          <Sparkles size={14} className="text-sidebar-primary-foreground" strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate text-sidebar-foreground">{businessName ?? 'My Business'}</p>
            <p className="text-xs text-sidebar-foreground/50">AI Employee</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {getNavItems(role).map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-all ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'} ${
                active
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              }`}
            >
              <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 space-y-0.5 border-t border-sidebar-border">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={mounted ? (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') : 'Toggle theme'}
          className={`flex items-center gap-3 w-full rounded-lg text-sm transition-all text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
          suppressHydrationWarning
        >
          {mounted ? (theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />) : <Moon size={16} className="opacity-0" />}
          {!collapsed && (mounted ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : 'Theme')}
        </button>

        <button
          onClick={toggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center gap-3 w-full rounded-lg text-sm transition-all text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && 'Collapse'}
        </button>

        <button
          onClick={handleSignOut}
          aria-label="Sign out"
          className={`flex items-center gap-3 w-full rounded-lg text-sm transition-all text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
        >
          <LogOut size={16} />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
