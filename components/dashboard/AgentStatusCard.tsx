'use client'

import { motion } from 'motion/react'
import { formatRelativeTime } from '@/lib/format'
import { useAgentStatus } from '@/lib/hooks/useAgentStatus'
import type { AgentStatus } from '@/lib/types'
import { Phone, MessageSquare, Wifi, WifiOff } from 'lucide-react'

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
  idle:    { label: 'Idle',    dotClass: 'bg-brand-warning', icon: <Phone size={14} />,      description: 'Standing by' },
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
  const effectiveStatus = isActive ? status : 'offline'
  const effectiveConfig = isActive ? config : STATUS_CONFIG.offline

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
          {effectiveConfig.description}
          {lastCallAt && ` · Last call ${formatRelativeTime(lastCallAt)}`}
        </p>
      </div>

      {/* 24/7 badge */}
      <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-success/10 text-brand-success text-xs font-semibold">
        24/7
      </div>
    </motion.div>
  )
}
