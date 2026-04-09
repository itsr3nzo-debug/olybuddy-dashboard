'use client'

import { motion } from 'motion/react'
import { formatCurrency } from '@/lib/format'
import { Phone, MessageSquare } from 'lucide-react'
import type { Opportunity } from '@/lib/types'

interface KanbanCardProps {
  opportunity: Opportunity & {
    contacts?: { first_name: string | null; last_name: string | null; company: string | null; phone: string | null } | null
  }
}

export default function KanbanCard({ opportunity: opp }: KanbanCardProps) {
  const name = opp.contacts
    ? [opp.contacts.first_name, opp.contacts.last_name].filter(Boolean).join(' ') || 'Unknown'
    : 'Unknown'
  const company = opp.contacts?.company

  return (
    <motion.div
      layout
      layoutId={opp.id}
      draggable="true"
      onDragStart={(e) => {
        const evt = e as unknown as React.DragEvent
        evt.dataTransfer?.setData('text/plain', opp.id)
      }}
      className="rounded-xl border bg-card p-3.5 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow group"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{opp.title || name}</p>
          {company && <p className="text-xs text-muted-foreground truncate">{company}</p>}
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
    </motion.div>
  )
}
