'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'motion/react'
import { Search, LayoutDashboard, Phone, BarChart3, PoundSterling, Settings, Moon, Sun, LogOut, Command, Kanban, MessageSquare, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const PAGES = [
  { href: '/dashboard',      label: 'Overview',       icon: LayoutDashboard },
  { href: '/pipeline',       label: 'Pipeline',        icon: Kanban },
  { href: '/conversations',  label: 'Inbox',           icon: MessageSquare },
  { href: '/calls',          label: 'Call Log',         icon: Phone },
  { href: '/performance',    label: 'Performance',      icon: BarChart3 },
  { href: '/money',          label: 'Money',            icon: PoundSterling },
  { href: '/settings',       label: 'Settings',         icon: Settings },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { theme, setTheme } = useTheme()

  // Cmd+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const q = query.toLowerCase().trim()

  const filteredPages = PAGES.filter(p =>
    p.label.toLowerCase().includes(q) || p.href.includes(q)
  )

  const actions = [
    {
      label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      icon: theme === 'dark' ? Sun : Moon,
      action: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); setOpen(false) },
    },
    {
      label: 'Sign out',
      icon: LogOut,
      action: async () => {
        const supabase = createClient()
        await supabase.auth.signOut()
        router.push('/login')
        setOpen(false)
      },
    },
  ].filter(a => !q || a.label.toLowerCase().includes(q))

  const allItems = [
    ...filteredPages.map(p => ({ type: 'page' as const, ...p })),
    ...actions.map(a => ({ type: 'action' as const, ...a })),
  ]

  const handleSelect = useCallback((index: number) => {
    const item = allItems[index]
    if (!item) return
    if (item.type === 'page') {
      router.push(item.href)
      setOpen(false)
    } else {
      item.action()
    }
  }, [allItems, router])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % allItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + allItems.length) % allItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(selectedIndex)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 -translate-x-1/2 w-full max-w-lg"
          >
            <div className="rounded-2xl border bg-card shadow-2xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                <Search size={16} className="text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search pages, calls, actions..."
                  className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground">
                  <Command size={10} />K
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-72 overflow-y-auto py-2">
                {allItems.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No results found</p>
                ) : (
                  <>
                    {filteredPages.length > 0 && (
                      <div className="px-3 py-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Pages</p>
                        {filteredPages.map((page, i) => {
                          const Icon = page.icon
                          return (
                            <button
                              key={page.href}
                              onClick={() => handleSelect(i)}
                              className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors ${
                                selectedIndex === i ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                              }`}
                            >
                              <Icon size={16} />
                              {page.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {actions.length > 0 && (
                      <div className="px-3 py-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">Actions</p>
                        {actions.map((action, i) => {
                          const idx = filteredPages.length + i
                          const Icon = action.icon
                          return (
                            <button
                              key={action.label}
                              onClick={() => handleSelect(idx)}
                              className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors ${
                                selectedIndex === idx ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                              }`}
                            >
                              <Icon size={16} />
                              {action.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
