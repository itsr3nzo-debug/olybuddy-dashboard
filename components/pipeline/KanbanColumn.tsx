'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/format'
import type { Opportunity } from '@/lib/types'
import KanbanCard from './KanbanCard'

interface KanbanColumnProps {
  stageKey: string
  stageLabel: string
  stageHex: string
  opportunities: (Opportunity & {
    contacts?: { first_name: string | null; last_name: string | null; company: string | null; phone: string | null } | null
  })[]
  onDrop: (opportunityId: string, newStage: string) => void
}

export default function KanbanColumn({ stageKey, stageLabel, stageHex, opportunities, onDrop }: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const totalValue = opportunities.reduce((sum, o) => sum + (o.value_pence ?? 0), 0)

  return (
    <div
      className={`flex flex-col min-w-[260px] sm:min-w-[280px] max-w-[320px] flex-shrink-0 rounded-xl border transition-colors ${isDragOver ? 'border-brand-primary/50 bg-brand-primary/5' : 'bg-muted/30'}`}
      style={{ borderColor: isDragOver ? undefined : 'var(--border)' }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const oppId = e.dataTransfer.getData('text/plain')
        if (oppId) onDrop(oppId, stageKey)
      }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: stageHex }} />
          <span className="text-xs font-semibold text-foreground">{stageLabel}</span>
          <span className="flex items-center justify-center h-5 min-w-[20px] rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
            {opportunities.length}
          </span>
        </div>
        {totalValue > 0 && (
          <span className="text-[10px] font-semibold text-brand-success">{formatCurrency(totalValue)}</span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)] min-h-[100px]">
        {opportunities.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
            Drop here
          </div>
        ) : (
          opportunities.map(opp => <KanbanCard key={opp.id} opportunity={opp} />)
        )}
      </div>
    </div>
  )
}
