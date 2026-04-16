'use client'

import { useState, useOptimistic, useTransition } from 'react'
import { DndContext, DragOverlay, closestCorners, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core'
import { toast } from 'sonner'
import { PIPELINE_STAGES } from '@/lib/constants'
import { updateOpportunityStage } from '@/app/(dashboard)/pipeline/actions'
import type { Opportunity, PipelineStage } from '@/lib/types'
import KanbanColumn from './KanbanColumn'
import KanbanCard from './KanbanCard'
import { formatCurrency } from '@/lib/format'

type OppWithContact = Opportunity & {
  contacts?: { first_name: string | null; last_name: string | null; company: string | null; phone: string | null } | null
}

interface KanbanBoardProps {
  opportunities: OppWithContact[]
}

export default function KanbanBoard({ opportunities }: KanbanBoardProps) {
  const [isPending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [optimisticOpps, setOptimisticOpps] = useOptimistic(
    opportunities,
    (state: OppWithContact[], { id, newStage }: { id: string; newStage: string }) =>
      state.map(o => o.id === id ? { ...o, stage: newStage as PipelineStage } : o)
  )

  const totalValue = opportunities.reduce((sum, o) => sum + (o.value_pence ?? 0), 0)
  const wonCount = opportunities.filter(o => o.stage === 'won').length
  const openCount = opportunities.filter(o => o.stage !== 'won' && o.stage !== 'lost').length

  const activeOpp = activeId ? optimisticOpps.find(o => o.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const opportunityId = String(active.id)
    const newStage = String(over.id)
    const current = optimisticOpps.find(o => o.id === opportunityId)
    if (!current || current.stage === newStage) return

    startTransition(async () => {
      setOptimisticOpps({ id: opportunityId, newStage })
      try {
        await updateOpportunityStage(opportunityId, newStage as PipelineStage)
        toast.success('Deal moved')
      } catch (e) {
        toast.error('Failed to move deal: ' + (e instanceof Error ? e.message : 'Unknown error'))
      }
    })
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Pipeline Value:</span>
          <span className="text-sm font-bold text-brand-success">{formatCurrency(totalValue)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Open:</span>
          <span className="text-sm font-semibold text-foreground">{openCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Won:</span>
          <span className="text-sm font-semibold text-brand-success">{wonCount}</span>
        </div>
        {isPending && (
          <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>
        )}
      </div>

      {/* Kanban columns with dnd-kit */}
      <DndContext collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
          {PIPELINE_STAGES.map(stage => {
            const stageOpps = optimisticOpps.filter(o => o.stage === stage.key)
            return (
              <KanbanColumn
                key={stage.key}
                stageKey={stage.key}
                stageLabel={stage.label}
                stageHex={stage.hex}
                opportunities={stageOpps}
              />
            )
          })}
        </div>

        {/* Drag overlay — the floating card that follows cursor */}
        <DragOverlay>
          {activeOpp ? (
            <div className="rotate-2 scale-105">
              <KanbanCard opportunity={activeOpp} isDragOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
