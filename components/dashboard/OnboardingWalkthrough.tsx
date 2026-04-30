'use client'

/**
 * OnboardingWalkthrough — v2.
 *
 * First-visit welcome modal. Renders only when:
 *   showFirstRun=true (server: zero conversations, zero calls, signed up
 *   <72h ago) AND localStorage hasn't recorded a dismissal AND a
 *   `loomUrl` is configured (env var).
 *
 * v2 changes:
 * - Killed the indigo→violet header gradient + Sparkles tile + "Welcome,
 *   Renzo — here's a 2-min tour" copy. Title is sentence-case neutral.
 * - rounded-2xl modal → 8px (Card-aligned)
 * - Step cards drop the bg-white/[0.02] glass treatment in favour of
 *   plain hairline-bordered tiles
 * - Primary "Got it" CTA uses solid navy (Button default), not gradient
 * - Backdrop blur-sm → flat 70% black overlay (still clearly modal)
 *
 * Behavioural unchanged: localStorage gate, custom-event re-open hook,
 * AnimatePresence transitions, hydration guard.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Play, X, Smartphone, Plug, MessageCircle } from 'lucide-react'

interface Props {
  showFirstRun: boolean
  loomUrl: string | null
  ownerName?: string | null
}

const STORAGE_KEY = 'nexley:walkthrough-seen-v1'

export default function OnboardingWalkthrough({ showFirstRun, loomUrl, ownerName }: Props) {
  const [open, setOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setHydrated(true)
    if (!showFirstRun) return
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY)
      if (!seen) setOpen(true)
    } catch {
      /* corruption — ignore */
    }
  }, [showFirstRun])

  function dismiss(remember: boolean) {
    setOpen(false)
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString())
      } catch {
        /* quota */
      }
    }
  }

  // Custom event hook lets a "Replay tour" item elsewhere re-open this.
  useEffect(() => {
    function open() {
      setOpen(true)
    }
    window.addEventListener('nexley:open-walkthrough', open)
    return () => window.removeEventListener('nexley:open-walkthrough', open)
  }, [])

  if (!hydrated) return null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => dismiss(false)}
          className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-lg border border-border bg-popover shadow-[0_24px_80px_rgba(0,0,0,0.5)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
                  {ownerName ? `Welcome, ${ownerName}.` : 'Welcome.'}
                </h2>
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  A 2-minute walkthrough of what your AI Employee does and how to get it live this week.
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(false)}
                className="-mr-1 -mt-0.5 size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            {/* Video / placeholder */}
            <div className="aspect-video bg-black border-b border-border">
              {loomUrl ? (
                <iframe
                  title="Nexley AI walkthrough"
                  src={loomUrl}
                  allow="fullscreen; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-center px-4">
                  <Play size={28} strokeWidth={1.5} className="text-muted-foreground/60 mb-2" />
                  <p className="text-sm text-foreground font-medium">Walkthrough video coming this week</p>
                  <p className="text-xs text-muted-foreground mt-1">For now, use the steps below to get live in 5 minutes.</p>
                </div>
              )}
            </div>

            {/* Quick-reference steps */}
            <div className="px-5 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Step
                icon={<Smartphone size={14} strokeWidth={1.5} />}
                index={1}
                title="Pair WhatsApp"
                body="Scan one QR code with WhatsApp Business. Replies start instantly."
              />
              <Step
                icon={<Plug size={14} strokeWidth={1.5} />}
                index={2}
                title="Connect tools"
                body="Gmail, Calendar, Xero — one click each. Settings → Integrations."
              />
              <Step
                icon={<MessageCircle size={14} strokeWidth={1.5} />}
                index={3}
                title="Send a test"
                body="Message your business number from another phone — watch the AI book the job."
              />
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 sm:px-6 py-3 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                You can replay this tour any time from the dashboard menu.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => dismiss(false)}
                  className="text-sm font-medium h-9 px-3 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(true)}
                  className="text-sm font-medium h-9 px-3.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Step({
  icon,
  index,
  title,
  body,
}: {
  icon: React.ReactNode
  index: number
  title: string
  body: string
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono tabular-nums text-[11px] text-muted-foreground">
          {index}
        </span>
        <span className="text-muted-foreground/60">{icon}</span>
        <p className="text-sm font-semibold text-foreground tracking-tight">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}
