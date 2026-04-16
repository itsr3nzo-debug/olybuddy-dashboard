'use client'

/**
 * Dashboard banner that shows the client where their AI Employee is in the
 * provisioning pipeline. Hidden once state === 'live'.
 *
 * Polls /api/provisioning/status every 20s while not live.
 */

import { useEffect, useState } from 'react'
import { Loader2, Server, CheckCircle2, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'

type State = 'awaiting_vps' | 'provisioning' | 'live' | 'attention' | 'unknown'

type StatusResponse = {
  state: State
  message: string
  vps_ready: boolean
  vps_ready_at: string | null
  pending_count: number
}

export default function ProvisioningBanner() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const res = await fetch('/api/provisioning/status', { credentials: 'include' })
        if (!res.ok) throw new Error('status fetch failed')
        const data: StatusResponse = await res.json()
        if (cancelled) return
        setStatus(data)
        // Keep polling while not live (or attention — so client sees errors clear)
        if (data.state !== 'live') {
          timer = setTimeout(poll, 20_000)
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 30_000)
      }
    }
    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!status || status.state === 'live' || dismissed) return null

  const style: Record<State, { bg: string; border: string; icon: React.ReactNode; accent: string }> = {
    awaiting_vps: {
      bg: 'bg-indigo-500/5',
      border: 'border-indigo-500/30',
      icon: <Server size={18} className="text-indigo-400" />,
      accent: 'text-indigo-300',
    },
    provisioning: {
      bg: 'bg-amber-500/5',
      border: 'border-amber-500/30',
      icon: <Loader2 size={18} className="text-amber-400 animate-spin" />,
      accent: 'text-amber-300',
    },
    attention: {
      bg: 'bg-red-500/5',
      border: 'border-red-500/30',
      icon: <AlertCircle size={18} className="text-red-400" />,
      accent: 'text-red-300',
    },
    live: {
      bg: '',
      border: '',
      icon: <CheckCircle2 size={18} className="text-green-400" />,
      accent: 'text-green-300',
    },
    unknown: {
      bg: 'bg-slate-500/5',
      border: 'border-slate-500/30',
      icon: <Server size={18} className="text-slate-400" />,
      accent: 'text-slate-300',
    },
  }

  const s = style[status.state]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className={`rounded-xl border ${s.border} ${s.bg} px-4 py-3 mb-4 flex items-center gap-3`}
      >
        <div className="flex-shrink-0">{s.icon}</div>
        <div className="flex-1 text-sm text-foreground">
          <span className={`font-medium ${s.accent}`}>
            {status.state === 'awaiting_vps' && 'Setting up your AI Employee'}
            {status.state === 'provisioning' && 'Applying changes'}
            {status.state === 'attention' && 'Needs attention'}
            {status.state === 'unknown' && 'Status unknown'}
          </span>
          <span className="text-muted-foreground ml-2">{status.message}</span>
        </div>
        {status.state === 'attention' && (
          <button
            onClick={() => setDismissed(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
