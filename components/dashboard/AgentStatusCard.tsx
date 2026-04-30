'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { formatRelativeTime } from '@/lib/format'
import { useAgentStatus } from '@/lib/hooks/useAgentStatus'
import type { AgentStatus } from '@/lib/types'
import { Pause, Play, Loader2 } from 'lucide-react'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/lib/utils'

interface AgentStatusCardProps {
  agentName: string
  status: AgentStatus
  lastCallAt: string | null
  isActive: boolean
  clientId?: string
}

/**
 * AgentStatusCard — v2.
 *
 * Stripped of:
 * - Coloured icon tile (was rounded-xl bg-muted with a Wifi/MessageSquare
 *   inside; bouncy and unfocused)
 * - Right-side "24/7" pill (decorative; kept claim better lives in the
 *   "money saved" hero context)
 * - rounded-xl that read as "card-among-cards"
 *
 * Replaced with:
 * - StatusDot in the top-left, lightweight indicator with optional pulse
 * - Agent name + label + last-call inline (one row of meaning)
 * - Pause/Resume button on the right with a hairline destructive style
 *   when paused
 *
 * Preserved:
 * - Realtime status hook (useAgentStatus)
 * - Optimistic pause/resume + rollback on error
 * - Confirmation dialog on pause (it's a kill-switch — must confirm)
 */

const STATUS_LABEL: Record<AgentStatus, { label: string; dot: 'live' | 'online' | 'warming' | 'offline'; description: string }> = {
  online:  { label: 'Online',     dot: 'live',    description: 'Handling messages' },
  in_call: { label: 'In a call',  dot: 'live',    description: 'Working on a conversation' },
  idle:    { label: 'Idle',       dot: 'online',  description: 'Standing by' },
  offline: { label: 'Offline',    dot: 'offline', description: 'Not currently active' },
}

export default function AgentStatusCard({
  agentName,
  status: initialStatus,
  lastCallAt: initialLastCallAt,
  isActive,
  clientId,
}: AgentStatusCardProps) {
  const { status: realtimeStatus, lastCallAt: realtimeLastCallAt } = useAgentStatus({
    clientId,
    initialStatus,
    initialLastCallAt,
  })

  const [activeLocal, setActiveLocal] = useState<boolean>(isActive)
  const [toggling, setToggling] = useState(false)

  const effectiveStatus: AgentStatus = activeLocal ? realtimeStatus : 'offline'
  const config = STATUS_LABEL[effectiveStatus] ?? STATUS_LABEL.online

  const togglePause = async () => {
    if (activeLocal) {
      const ok = window.confirm(
        `Pause ${agentName}?\n\nWhile paused, customers messaging on WhatsApp or calling won't get a reply. Owner messages are still handled. You can resume from the same button.`,
      )
      if (!ok) return
    }
    setToggling(true)
    const targetPaused = activeLocal
    setActiveLocal(!activeLocal)
    try {
      const res = await fetch('/api/settings/pause-agent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: targetPaused }),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      setActiveLocal(activeLocal)
      window.alert('Could not update pause state — please try again.')
    } finally {
      setToggling(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-border bg-card p-4 mb-4"
      role="status"
      aria-label={`Agent ${agentName} ${config.label}`}
    >
      <div className="flex items-center gap-3">
        {/* Status dot — left edge */}
        <StatusDot status={config.dot} size="lg" />

        <div className="flex-1 min-w-0">
          {/* Top row: agent name + state label */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground tracking-tight">
              {agentName}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                effectiveStatus === 'offline' ? 'text-muted-foreground' : 'text-success',
              )}
            >
              {config.label}
            </span>
          </div>

          {/* Sub-row: description + last call */}
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {activeLocal ? config.description : 'Paused — messages queue until resumed'}
            {realtimeLastCallAt && (
              <span className="ml-1 text-muted-foreground/70">
                · Last call {formatRelativeTime(realtimeLastCallAt)}
              </span>
            )}
          </p>
        </div>

        {/* Pause / Resume button — kill-switch */}
        <button
          type="button"
          onClick={togglePause}
          disabled={toggling}
          aria-label={activeLocal ? 'Pause agent' : 'Resume agent'}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-sm border whitespace-nowrap',
            'transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            activeLocal
              ? 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/60'
              : 'border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50',
          )}
        >
          {toggling ? (
            <Loader2 size={12} className="animate-spin" strokeWidth={1.75} />
          ) : activeLocal ? (
            <Pause size={12} strokeWidth={1.75} />
          ) : (
            <Play size={12} strokeWidth={1.75} />
          )}
          {activeLocal ? 'Pause' : 'Resume'}
        </button>
      </div>
    </motion.div>
  )
}
