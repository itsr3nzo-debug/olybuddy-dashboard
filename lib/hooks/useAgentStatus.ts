'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AgentStatus } from '@/lib/types'

interface UseAgentStatusOptions {
  clientId: string | undefined
  initialStatus?: AgentStatus
  initialLastCallAt?: string | null
}

export function useAgentStatus({ clientId, initialStatus = 'online', initialLastCallAt = null }: UseAgentStatusOptions) {
  const [status, setStatus] = useState<AgentStatus>(initialStatus)
  const [lastCallAt, setLastCallAt] = useState<string | null>(initialLastCallAt)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!clientId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`agent-status-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_config',
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>
          if (row.agent_status) setStatus(row.agent_status as AgentStatus)
          if (row.last_call_at) setLastCallAt(row.last_call_at as string)
        }
      )
      .subscribe((s) => {
        setIsConnected(s === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clientId])

  return { status, lastCallAt, isConnected }
}
