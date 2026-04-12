'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Phone, LayoutDashboard, BarChart3, PoundSterling, Settings, LogOut, Sun, Moon, PanelLeftClose, PanelLeft, Kanban, MessageSquare, Calendar, ScrollText, FileBarChart, Plug } from 'lucide-react'

const navItems = [
  // Main
  { href: '/dashboard',      label: 'Overview',       Icon: LayoutDashboard },
  { href: '/pipeline',       label: 'Pipeline',       Icon: Kanban },
  { href: '/conversations',  label: 'Inbox',          Icon: MessageSquare },
  { href: '/calls',          label: 'Call Log',       Icon: Phone },
  // Analytics
  { href: '/performance',    label: 'Performance',    Icon: BarChart3 },
  { href: '/reporting',      label: 'Reporting',      Icon: FileBarChart },
  { href: '/money',          label: 'Money',          Icon: PoundSterling },
  // Tools
  { href: '/calendar',       label: 'Calendar',       Icon: Calendar },
  { href: '/integrations',   label: 'Integrations',   Icon: Plug },
  { href: '/agent-logs',     label: 'Agent Logs',     Icon: ScrollText },
  { href: '/settings',       label: 'Settings',       Icon: Settings },
]

export default function Sidebar({ businessName }: { businessName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
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
          <Phone size={14} className="text-sidebar-primary-foreground" strokeWidth={2.5} />
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
        {navItems.map(({ href, label, Icon }) => {
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
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className={`flex items-center gap-3 w-full rounded-lg text-sm transition-all text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
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
