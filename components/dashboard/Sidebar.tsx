'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  Plug,
  Shield,
  Users,
  Bot,
  Target,
  ChevronUp,
  HelpCircle,
} from 'lucide-react'
import type { UserRole } from '@/lib/rbac'
import { MEMBER_BLOCKED_PAGES } from '@/lib/rbac'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/lib/utils'

/**
 * Sidebar — v2.
 *
 * Visual changes from v1:
 * - Monogram tile (first letter of business name) replaces Sparkles
 *   icon. AI cliché killed; tile feels deliberate, like Linear's
 *   workspace pip.
 * - Live agent status dot next to the business name in the header.
 *   Hooked to a future `agentStatus` prop; defaults to "online" so
 *   nothing breaks during the gradual roll-out of agent_config wiring.
 * - Nav grouped under small-caps section labels (WORKSPACE / ACCOUNT)
 *   instead of a single flat list. Section labels are 11px,
 *   tracking-wider, muted-foreground.
 * - User menu (theme + collapse + sign out) consolidated into a popover
 *   anchored bottom-left. Replaces three stacked buttons. Cleaner
 *   visual rhythm + matches Linear/Mercury/Vercel pattern.
 * - All inactive items use stroke 1.5 (was 2). Active items use stroke
 *   1.75 (was 2.5). Lighter overall feel.
 *
 * Behavioural unchanged:
 * - localStorage-persisted collapse
 * - SSR/CSR mounted guard for theme toggle
 * - role-based nav filtering (member sees subset, super_admin sees admin
 *   prepend)
 *
 * Nav still has 6 items — preserving the deliberate trim from v1
 * (`see docs note in settings/page.tsx`). Phase 4 will retarget
 * Sender Roles + Agent Trust into the new /agent consolidated page.
 */

const allNavItems: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard',  label: 'Home',  Icon: LayoutDashboard },
      { href: '/chat',       label: 'Chat',  Icon: Bot },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/integrations',          label: 'Integrations', Icon: Plug },
      { href: '/settings/sender-roles', label: 'Senders',      Icon: Users },
      { href: '/settings/agent-trust',  label: 'Trust',        Icon: Shield },
      { href: '/settings',              label: 'Settings',     Icon: Settings },
    ],
  },
]

interface NavItem {
  href: string
  label: string
  Icon: typeof LayoutDashboard
}

interface NavSection {
  label: string
  items: NavItem[]
}

function getNavSections(role: UserRole): NavSection[] {
  let sections = allNavItems

  if (role === 'member') {
    // Strip blocked routes inside each section. Keep section even if
    // empty so the visual rhythm holds (rare since members at least
    // see Dashboard/Chat).
    sections = sections
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) => !MEMBER_BLOCKED_PAGES.some((p) => i.href === p || i.href.startsWith(p + '/')),
        ),
      }))
      .filter((s) => s.items.length > 0)
  }

  if (role === 'super_admin') {
    sections = [
      {
        label: 'Admin',
        items: [
          { href: '/admin',       label: 'Admin',   Icon: Shield },
          { href: '/admin/close', label: 'Clients', Icon: Target },
        ],
      },
      ...sections,
    ]
  }

  return sections
}

export default function Sidebar({
  businessName,
  role = 'owner',
  agentStatus = 'online',
}: {
  businessName?: string
  role?: UserRole
  agentStatus?: 'online' | 'live' | 'warming' | 'offline' | 'error'
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const supabase = createClient()
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') setCollapsed(true)
    setMounted(true)
  }, [])

  function toggleCollapse() {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev))
      return !prev
    })
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Monogram = first capitalised letter of business name. Fallback "N"
  // for accounts where business name hasn't loaded yet.
  const monogram = (businessName?.trim()?.[0] ?? 'N').toUpperCase()

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex flex-col h-screen fixed left-0 top-0 z-40',
        'border-r border-sidebar-border bg-sidebar',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* ── Header — monogram tile + business name + status dot ──── */}
      <header
        className={cn(
          'flex items-center gap-2.5 px-3 h-14 border-b border-sidebar-border',
          collapsed && 'justify-center px-2',
        )}
      >
        {/* Monogram tile — solid primary, white text. Reads "deliberate
            workspace identity" (Linear pattern), not "AI brand tile". */}
        <div
          aria-hidden
          className="size-7 shrink-0 rounded-md bg-sidebar-primary flex items-center justify-center text-[13px] font-semibold text-sidebar-primary-foreground tracking-tight"
        >
          {monogram}
        </div>

        {!collapsed && (
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <p className="text-sm font-semibold truncate text-sidebar-foreground">
              {businessName ?? 'Nexley AI'}
            </p>
            <StatusDot status={agentStatus} size="sm" />
          </div>
        )}
      </header>

      {/* ── Nav — sectioned with small-caps section headers ──────── */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        {getNavSections(role).map((section, sectionIndex) => (
          <div key={section.label} className={cn(sectionIndex > 0 && 'mt-5')}>
            {!collapsed && (
              <p className="px-2 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map(({ href, label, Icon }) => {
                const active =
                  pathname === href ||
                  (href !== '/dashboard' && pathname.startsWith(href))
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-label={label}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-md text-sm transition-colors',
                        // Density tuned to 32px row
                        collapsed ? 'justify-center h-8 w-10 mx-auto' : 'h-8 px-2.5',
                        active
                          ? 'bg-sidebar-accent text-sidebar-foreground font-medium'
                          : 'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 font-normal',
                      )}
                    >
                      <Icon size={16} strokeWidth={active ? 1.75 : 1.5} className="shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Footer — collapse toggle + user menu popover ─────────── */}
      <footer className="px-2 pb-3 pt-2 border-t border-sidebar-border space-y-0.5">
        {/* Collapse toggle — kept as a separate button (not in popover)
            because it needs to be reachable when collapsed. */}
        <button
          onClick={toggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex items-center gap-3 rounded-md text-sm transition-colors',
            'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            collapsed ? 'justify-center h-8 w-10 mx-auto' : 'h-8 w-full px-2.5',
          )}
        >
          {collapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {/* User menu — popover trigger. Anchored bottom-left.
            Linear/Mercury/Vercel/Stripe all park user controls here. */}
        <UserMenu
          collapsed={collapsed}
          mounted={mounted}
          theme={theme}
          setTheme={setTheme}
          handleSignOut={handleSignOut}
        />
      </footer>
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────
   UserMenu — bottom-left popover for theme / help / sign out.

   Anchors to its own button trigger. Opens on click, closes on click
   outside / Escape. Built without @base-ui/react/popover for now
   (lightweight + we don't yet need positioning logic) — can swap to
   the proper primitive if menus grow.
   ───────────────────────────────────────────────────────────────── */

function UserMenu({
  collapsed,
  mounted,
  theme,
  setTheme,
  handleSignOut,
}: {
  collapsed: boolean
  mounted: boolean
  theme: string | undefined
  setTheme: (t: string) => void
  handleSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-3 rounded-md text-sm transition-colors',
          'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
          'aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground',
          collapsed ? 'justify-center h-8 w-10 mx-auto' : 'h-8 w-full px-2.5',
        )}
      >
        {/* Tiny avatar circle — shows initial in primary tint */}
        <span className="size-5 shrink-0 rounded-full bg-sidebar-accent flex items-center justify-center text-[10px] font-semibold text-sidebar-foreground">
          {/* fallback monogram — could be wired to user.email[0] later */}
          U
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">Account</span>
            <ChevronUp
              size={14}
              strokeWidth={1.5}
              className={cn('shrink-0 transition-transform', open && 'rotate-180')}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50',
            // Anchor: open above the trigger, full-width-of-sidebar
            'bottom-full mb-1',
            collapsed ? 'left-full ml-2 w-44' : 'left-0 right-0',
            // Use sidebar tokens so the popover stays dark even in light
            // mode (sidebar is permanently dark — see globals.css). Reading
            // bg-popover here would make the popover white inside a dark
            // sidebar — jarring and looks like a theming bug.
            'rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-foreground',
            // The one place shadow IS the depth signal — popover lifts off.
            'shadow-[0_8px_24px_rgba(0,0,0,0.32)]',
            'p-1',
          )}
        >
          {/* Theme toggle */}
          <button
            role="menuitem"
            onClick={() => {
              setTheme(theme === 'dark' ? 'light' : 'dark')
              setOpen(false)
            }}
            className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
            suppressHydrationWarning
          >
            {mounted ? (
              theme === 'dark' ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />
            ) : (
              <Moon size={14} strokeWidth={1.5} className="opacity-0" />
            )}
            <span>
              {mounted ? (theme === 'dark' ? 'Light mode' : 'Dark mode') : 'Theme'}
            </span>
          </button>

          {/* Help / docs link */}
          <a
            role="menuitem"
            href="https://nexley.ai/help"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <HelpCircle size={14} strokeWidth={1.5} />
            <span>Help</span>
          </a>

          {/* Divider */}
          <div className="my-1 h-px bg-sidebar-border" />

          {/* Sign out */}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              handleSignOut()
            }}
            className="flex items-center gap-2 w-full h-8 px-2 rounded-md text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <LogOut size={14} strokeWidth={1.5} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}
