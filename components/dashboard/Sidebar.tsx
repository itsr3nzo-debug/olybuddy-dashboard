'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { Phone, List, Filter, PoundSterling, Settings, LogOut, Sun, Moon, LayoutDashboard } from 'lucide-react'

const navItems = [
  { href: '/dashboard',    label: 'Overview',     Icon: LayoutDashboard },
  { href: '/calls',        label: 'Call Log',      Icon: Phone },
  { href: '/pipeline',     label: 'Pipeline',      Icon: Filter },
  { href: '/performance',  label: 'Performance',   Icon: List },
  { href: '/money',        label: 'Money',         Icon: PoundSterling },
  { href: '/settings',     label: 'Settings',      Icon: Settings },
]

export default function Sidebar({ businessName }: { businessName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className="flex flex-col w-60 h-screen fixed left-0 top-0 z-40 border-r"
      style={{ background: 'var(--sidebar-bg)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      {/* Logo / Business Name */}
      <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent)' }}>
          <Phone size={14} color="white" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold truncate">{businessName ?? 'My Business'}</p>
          <p className="text-xs" style={{ color: '#64748b' }}>AI Employee</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: active ? '#a5b4fc' : '#64748b',
              }}
            >
              <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 space-y-0.5 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {/* Dark mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all"
          style={{ color: '#64748b' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>

        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all"
          style={{ color: '#64748b' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          aria-label="Sign out"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
