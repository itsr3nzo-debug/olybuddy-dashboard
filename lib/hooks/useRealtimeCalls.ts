'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallLog } from '@/lib/types'

interface UseRealtimeCallsOptions {
  clientId: string | undefined
  onNewCall?: (call: CallLog) => void
}

export function useRealtimeCalls({ clientId, onNewCall }: UseRealtimeCallsOptions) {
  const [latestCall, setLatestCall] = useState<CallLog | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const handleNewCall = useCallback((call: CallLog) => {
    setLatestCall(call)
    onNewCall?.(call)
  }, [onNewCall])

  useEffect(() => {
    if (!clientId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`calls-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_logs',
          filter: `client_id=eq.${clientId}`,
        },
        (payload) => {
          handleNewCall(payload.new as CallLog)
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clientId, handleNewCall])

  return { latestCall, isConnected }
}
