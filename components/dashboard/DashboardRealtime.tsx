'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useRealtimeCalls } from '@/lib/hooks/useRealtimeCalls'
import type { CallLog } from '@/lib/types'
import { callerDisplayName, formatDuration } from '@/lib/format'
import LiveIndicator from '@/components/shared/LiveIndicator'
import RecentCallsTable from '@/components/dashboard/RecentCallsTable'

interface DashboardRealtimeProps {
  initialCalls: CallLog[]
  clientId: string | undefined
}

export default function DashboardRealtime({ initialCalls, clientId }: DashboardRealtimeProps) {
  const [calls, setCalls] = useState<CallLog[]>(initialCalls)

  const handleNewCall = useCallback((call: CallLog) => {
    setCalls(prev => [call, ...prev].slice(0, 10))
    const name = callerDisplayName(call)
    const dur = formatDuration(call.duration_seconds)
    toast.success(`New call from ${name}`, {
      description: `Duration: ${dur} · ${call.direction}`,
    })
  }, [])

  const { isConnected } = useRealtimeCalls({ clientId, onNewCall: handleNewCall })

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Recent Calls</h2>
        <LiveIndicator isConnected={isConnected} />
      </div>
      <RecentCallsTable calls={calls} />
    </div>
  )
}
