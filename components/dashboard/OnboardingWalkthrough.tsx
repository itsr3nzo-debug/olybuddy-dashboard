'use client'

/**
 * Onboarding walkthrough (#19).
 *
 * First-visit welcome modal with an embedded Loom video covering:
 *   - what the AI Employee actually does
 *   - how to pair WhatsApp (60s, one QR)
 *   - how to connect Gmail/Calendar/Xero
 *   - what to expect in the next 5 days
 *
 * Triggers automatically when the dashboard renders with `showFirstRun=true`
 * (server decides — typically when there are zero conversations AND zero
 * calls AND user signed up <72h ago). Dismissible; choice persists in
 * localStorage so it doesn't re-appear on every visit.
 *
 * Set `loomUrl` from server props — falls back to a placeholder if Renzo
 * hasn't recorded the video yet.
 */

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Play, X, Sparkles, Smartphone, Plug, MessageCircle } from 'lucide-react'

interface Props {
  /** Render the modal automatically on first visit. */
  showFirstRun: boolean
  /** Loom share URL ending in /share/{id} or null until we record it. */
  loomUrl: string | null
  /** Owner first name for personalisation. */
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
    } catch { /* corruption — ignore */ }
  }, [showFirstRun])

  function dismiss(remember: boolean) {
    setOpen(false)
    if (remember) {
      try { window.localStorage.setItem(STORAGE_KEY, new Date().toISOString()) } catch { /* quota */ }
    }
  }

  // Allow re-opening manually from elsewhere via a custom event so the
  // dashboard "Replay tour" button works even after dismissal.
  useEffect(() => {
    function open() { setOpen(true) }
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
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 220, damping: 22 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0d1426] shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 sm:p-6 border-b border-white/5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                  <Sparkles size={18} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold text-white">
                    Welcome{ownerName ? `, ${ownerName}` : ''} \u2014 here\u2019s a 2-min tour
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                    What your AI Employee does, how to set it up, and what to expect this week.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Video / placeholder */}
            <div className="aspect-video bg-black border-b border-white/5">
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
                  <div className="w-16 h-16 rounded-full bg-indigo-500/15 flex items-center justify-center mb-3">
                    <Play size={28} className="text-indigo-400" />
                  </div>
                  <p className="text-sm text-slate-300 font-medium">Walkthrough video coming this week</p>
                  <p className="text-xs text-slate-500 mt-1">For now \u2014 use the steps below to get live in 5 minutes.</p>
                </div>
              )}
            </div>

            {/* Quick-reference steps */}
            <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Step
                icon={<Smartphone size={16} className="text-indigo-300" />}
                title="1. Pair WhatsApp"
                body="Scan one QR code with WhatsApp Business. Your AI Employee starts answering immediately."
              />
              <Step
                icon={<Plug size={16} className="text-emerald-300" />}
                title="2. Connect tools"
                body="Gmail, Calendar, Xero \u2014 one click each. Settings \u2192 Integrations."
              />
              <Step
                icon={<MessageCircle size={16} className="text-violet-300" />}
                title="3. Send a test"
                body="Message your business number from another phone \u2014 watch the AI book the job."
              />
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-5 sm:p-6 border-t border-white/5 bg-white/[0.02]">
              <p className="text-xs text-slate-400">
                You can replay this tour any time from the dashboard menu.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => dismiss(false)}
                  className="text-xs font-medium px-3 py-2 rounded-lg text-slate-300 hover:bg-white/5 transition"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(true)}
                  className="text-xs font-semibold px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90 transition"
                >
                  Got it \u2014 don\u2019t show again
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Step({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">{icon}</div>
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
    </div>
  )
}
