'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { formatCurrency } from '@/lib/format'
import { Phone, MessageSquare, GripVertical } from 'lucide-react'
import type { Opportunity } from '@/lib/types'

interface KanbanCardProps {
  opportunity: Opportunity & {
    contacts?: { first_name: string | null; last_name: string | null; company: string | null; phone: string | null } | null
  }
  isDragOverlay?: boolean
}

export default function KanbanCard({ opportunity: opp, isDragOverlay }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
  })

  const name = opp.contacts
    ? [opp.contacts.first_name, opp.contacts.last_name].filter(Boolean).join(' ') || 'Unknown'
    : 'Unknown'
  const company = opp.contacts?.company

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-border bg-card p-3.5 transition-colors group ${
        isDragOverlay
          // The drag-overlay is the ONE place where shadow IS the depth signal
          // (Linear / Stripe pattern — lifted card during reorder).
          ? 'shadow-[0_8px_24px_rgba(0,0,0,0.32)] border-primary/40'
          : isDragging
            ? 'opacity-30'
            // Hairline-only at rest. Hover bg shift instead of shadow growth.
            : 'cursor-grab active:cursor-grabbing hover:bg-muted/40 hover:border-border'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{opp.title || name}</p>
          {company && <p className="text-xs text-muted-foreground truncate">{company}</p>}
        </div>
        <div
          {...listeners}
          {...attributes}
          className="flex-shrink-0 p-1 -mr-1 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
        >
          <GripVertical size={14} />
        </div>
      </div>

      {opp.value_pence > 0 && (
        <p className="text-sm font-bold text-brand-success mb-2">{formatCurrency(opp.value_pence)}</p>
      )}

      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {opp.contacts?.phone && (
          <a
            href={`tel:${opp.contacts.phone}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 transition-colors"
            aria-label="Call"
          >
            <Phone size={12} />
          </a>
        )}
        <button
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-muted text-muted-foreground"
          aria-label="Message"
          disabled
        >
          <MessageSquare size={12} />
        </button>
      </div>
    </div>
  )
}
