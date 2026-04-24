'use client'

import { useState } from 'react'
import { motion } from 'motion/react'
import { formatRelativeTime } from '@/lib/format'
import { useAgentStatus } from '@/lib/hooks/useAgentStatus'
import type { AgentStatus } from '@/lib/types'
import { Clock, MessageSquare, Wifi, WifiOff, Pause, Play, Loader2 } from 'lucide-react'

interface AgentStatusCardProps {
  agentName: string
  status: AgentStatus
  lastCallAt: string | null
  isActive: boolean
  clientId?: string
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; dotClass: string; icon: React.ReactNode; description: string }> = {
  online:  { label: 'Online',  dotClass: 'bg-brand-success', icon: <Wifi size={14} />,      description: 'Handling messages' },
  in_call: { label: 'Processing', dotClass: 'bg-brand-primary', icon: <MessageSquare size={14} />,  description: 'Working on a conversation' },
  idle:    { label: 'Idle',    dotClass: 'bg-brand-warning', icon: <Clock size={14} />,      description: 'Standing by' },
  offline: { label: 'Offline', dotClass: 'bg-brand-danger',  icon: <WifiOff size={14} />,    description: 'Not currently active' },
}

export default function AgentStatusCard({ agentName, status: initialStatus, lastCallAt: initialLastCallAt, isActive, clientId }: AgentStatusCardProps) {
  // Subscribe to realtime status changes
  const { status: realtimeStatus, lastCallAt: realtimeLastCallAt } = useAgentStatus({
    clientId,
    initialStatus,
    initialLastCallAt,
  })
  const status = realtimeStatus
  const lastCallAt = realtimeLastCallAt
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.online
  // `active` is the server-rendered value; `activeLocal` is the optimistic
  // client-side state after the user toggles Pause/Resume here. We keep both
  // so a failed request can roll back and a successful one doesn't wait for
  // a page refresh.
  const [activeLocal, setActiveLocal] = useState<boolean>(isActive)
  const [toggling, setToggling] = useState(false)
  const effectiveStatus = activeLocal ? status : 'offline'
  const effectiveConfig = activeLocal ? config : STATUS_CONFIG.offline

  const togglePause = async () => {
    // Nexley-level kill-switch — confirm before taking the agent down
    // because it stops responding to customers across all channels.
    if (activeLocal) {
      const ok = window.confirm(
        'Pause ' + agentName + '?\n\nWhile paused, customers messaging on WhatsApp or calling won\u2019t get a reply. Owner messages are still handled. You can resume from the same button.',
      )
      if (!ok) return
    }
    setToggling(true)
    const targetPaused = activeLocal // if currently active → we want paused
    // Optimistic flip
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
      // Roll back
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
      className="rounded-xl border p-4 mb-4 flex items-center gap-4 bg-card"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* Status dot with pulse */}
      <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
        {effectiveConfig.icon}
        <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${effectiveConfig.dotClass} ${effectiveStatus === 'online' || effectiveStatus === 'in_call' ? 'animate-pulse-live' : ''}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{agentName}</span>
          <span className={`text-xs font-medium ${effectiveStatus === 'online' ? 'text-brand-success' : effectiveStatus === 'in_call' ? 'text-brand-primary' : 'text-muted-foreground'}`}>
            {effectiveConfig.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {activeLocal ? effectiveConfig.description : 'Paused — messages queue until resumed'}
          {lastCallAt && ` · Last call ${formatRelativeTime(lastCallAt)}`}
        </p>
      </div>

      {/* Pause / Resume toggle — the emergency kill-switch. Previously
          lived only behind the sidebar "Pause agent" nav item. Now reachable
          in one click from the dashboard where the owner actually looks. */}
      <button
        type="button"
        onClick={togglePause}
        disabled={toggling}
        aria-label={activeLocal ? 'Pause agent' : 'Resume agent'}
        className={
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors focus-ring ' +
          (activeLocal
            ? 'border border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            : 'border border-red-500/30 text-red-400 hover:bg-red-500/10')
        }
      >
        {toggling ? (
          <Loader2 size={11} className="animate-spin" />
        ) : activeLocal ? (
          <Pause size={11} />
        ) : (
          <Play size={11} />
        )}
        {activeLocal ? 'Pause' : 'Resume'}
      </button>

      {/* 24/7 badge — only when the agent is running */}
      {activeLocal && (
        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-success/10 text-brand-success text-xs font-semibold">
          24/7
        </div>
      )}
    </motion.div>
  )
}
