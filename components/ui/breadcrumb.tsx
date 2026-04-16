'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const LABELS: Record<string, string> = {
  dashboard: 'Overview',
  pipeline: 'Pipeline',
  inbox: 'Inbox',
  calls: 'Calls',
  calendar: 'Calendar',
  integrations: 'Integrations',
  settings: 'Settings',
  money: 'Money Saved',
  performance: 'Performance',
  onboarding: 'Setup',
  'agent-logs': 'Agent Logs',
}

export function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const current = segments[segments.length - 1]
  const label = LABELS[current] ?? current.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
      <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
      {current !== 'dashboard' && (
        <>
          <ChevronRight size={12} className="opacity-40" />
          <span className="text-foreground font-medium">{label}</span>
        </>
      )}
    </nav>
  )
}
