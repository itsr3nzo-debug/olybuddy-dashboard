'use client'

import { cn } from '@/lib/utils'
import type { TranscriptTurn } from '@/lib/types'

interface TranscriptBubblesProps {
  transcript: TranscriptTurn[]
  activeTurnIndex?: number
  className?: string
}

export default function TranscriptBubbles({ transcript, activeTurnIndex, className }: TranscriptBubblesProps) {
  if (!transcript.length) return null

  return (
    <div className={cn('space-y-3 max-h-80 overflow-y-auto pr-1', className)}>
      {transcript.map((turn, idx) => {
        const isAI = turn.role === 'agent'
        const isActive = activeTurnIndex === idx

        return (
          <div
            key={idx}
            className={cn('flex gap-2', isAI ? 'justify-start' : 'justify-end')}
          >
            {isAI && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-bold text-brand-primary">
                A
              </div>
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed transition-colors',
                isAI
                  ? 'rounded-tl-sm bg-brand-primary/10 text-foreground'
                  : 'rounded-tr-sm bg-muted text-foreground',
                isActive && 'ring-2 ring-brand-primary/30'
              )}
            >
              <p>{turn.message}</p>
              {turn.time_in_call_secs !== undefined && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {Math.floor(turn.time_in_call_secs / 60)}:{String(Math.floor(turn.time_in_call_secs % 60)).padStart(2, '0')}
                </p>
              )}
              {turn.timestamp !== undefined && turn.time_in_call_secs === undefined && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {Math.floor(turn.timestamp / 60)}:{String(Math.floor(turn.timestamp % 60)).padStart(2, '0')}
                </p>
              )}
            </div>
            {!isAI && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                C
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
