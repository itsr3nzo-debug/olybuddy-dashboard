'use client'

import { useState } from 'react'
import type { CallLog } from '@/lib/types'
import { ChevronRight, Phone, PhoneOutgoing } from 'lucide-react'
import { formatDuration, formatRelativeTime, callerDisplayName } from '@/lib/format'
import { STATUS_CONFIG } from '@/lib/constants'
import TranscriptBubbles from '@/components/shared/TranscriptBubbles'
import { AI_PHONE_DISPLAY } from '@/lib/constants'

export default function RecentCallsTable({ calls }: { calls: CallLog[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="rounded-xl border overflow-hidden bg-card-bg">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Recent Calls</h2>
        <a href="/calls" className="text-xs font-medium text-brand-primary hover:underline">View all →</a>
      </div>

      {calls.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <Phone size={32} className="mx-auto mb-3 text-muted-foreground opacity-30" />
          <p className="text-sm font-medium mb-1 text-foreground">Your AI Employee is standing by</p>
          <p className="text-xs text-muted-foreground">Call {AI_PHONE_DISPLAY} to see your first call appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {calls.map(call => {
            const sc = STATUS_CONFIG[call.status]
            const caller = callerDisplayName(call)
            const hasDetail = call.summary || (Array.isArray(call.transcript) && call.transcript.length > 0)
            const isExpanded = expandedId === call.id

            return (
              <div key={call.id}>
                <button
                  onClick={() => hasDetail && setExpandedId(isExpanded ? null : call.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors touch-target ${
                    hasDetail ? 'cursor-pointer hover:bg-muted/30' : 'cursor-default'
                  } ${isExpanded ? 'bg-muted/30' : ''}`}
                  disabled={!hasDetail}
                >
                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-muted">
                    {call.direction === 'inbound'
                      ? <Phone size={14} className="text-brand-primary" />
                      : <PhoneOutgoing size={14} className="text-brand-success" />
                    }
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-foreground">{caller}</p>
                    {call.summary && (
                      <p className="text-xs truncate mt-0.5 text-muted-foreground">{call.summary}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{formatDuration(call.duration_seconds)}</span>
                    {sc && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sc.className}`}>
                        {sc.label}
                      </span>
                    )}
                    <span className="text-xs hidden sm:block text-muted-foreground">{formatRelativeTime(call.started_at)}</span>
                    {hasDetail && (
                      <ChevronRight size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 px-4 pb-4 pt-3">
                    {call.summary && (
                      <div className="mb-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                        <span className="font-semibold text-xs uppercase tracking-wide block mb-1 text-muted-foreground">AI Summary</span>
                        <span className="text-foreground">{call.summary}</span>
                      </div>
                    )}
                    {Array.isArray(call.transcript) && call.transcript.length > 0 && (
                      <TranscriptBubbles transcript={call.transcript} />
                    )}
                    {!call.summary && (!Array.isArray(call.transcript) || call.transcript.length === 0) && (
                      <p className="text-sm text-muted-foreground">No transcript available for this call.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
