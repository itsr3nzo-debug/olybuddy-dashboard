'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Phone, PoundSterling, List, MoreHorizontal } from 'lucide-react'

const tabs = [
  { href: '/dashboard',   label: 'Home',   Icon: LayoutDashboard },
  { href: '/calls',       label: 'Calls',  Icon: Phone },
  { href: '/money',       label: 'Money',  Icon: PoundSterling },
  { href: '/performance', label: 'Stats',  Icon: List },
  { href: '/settings',    label: 'More',   Icon: MoreHorizontal },
]

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t"
      style={{ background: 'var(--sidebar-bg)', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      {tabs.map(({ href, label, Icon }) => {
        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 text-xs font-medium min-h-[56px]"
            style={{ color: active ? '#a5b4fc' : '#64748b' }}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span style={{ fontSize: '10px' }}>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
