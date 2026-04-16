'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay, isToday,
  addMonths, subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PIPELINE_STAGES } from '@/lib/constants'

interface Opportunity {
  id: string
  title: string
  stage: string
  value_pence: number
  expected_close: string
  contacts?: { first_name: string | null; last_name: string | null } | null
}

interface MonthGridProps {
  opportunities: Opportunity[]
  initialMonth?: string // YYYY-MM
}

export default function MonthGrid({ opportunities, initialMonth }: MonthGridProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const monthParam = initialMonth || searchParams.get('month') || format(new Date(), 'yyyy-MM')
  const currentMonth = new Date(monthParam + '-01')

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  const oppsByDate: Record<string, Opportunity[]> = {}
  for (const opp of opportunities) {
    if (!opp.expected_close) continue
    const key = format(new Date(opp.expected_close), 'yyyy-MM-dd')
    if (!oppsByDate[key]) oppsByDate[key] = []
    oppsByDate[key].push(opp)
  }

  function navigate(offset: number) {
    const target = offset > 0 ? addMonths(currentMonth, 1) : subMonths(currentMonth, 1)
    router.push(`/calendar?month=${format(target, 'yyyy-MM')}`)
  }

  const selectedOpps = selectedDay ? (oppsByDate[selectedDay] || []) : []

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ChevronLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-foreground">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-muted transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-border bg-border">
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          const dayOpps = oppsByDate[key] || []
          const inMonth = isSameMonth(day, currentMonth)
          const today = isToday(day)
          const isSelected = selectedDay === key

          return (
            <button
              key={key}
              onClick={() => setSelectedDay(prev => prev === key ? null : key)}
              className={`min-h-[72px] sm:min-h-[88px] p-1.5 text-left transition-colors ${
                inMonth ? 'bg-card' : 'bg-card/50'
              } ${isSelected ? 'ring-2 ring-brand-primary ring-inset' : ''} hover:bg-muted/50`}
            >
              <span className={`text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full ${
                today ? 'bg-brand-primary text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground/50'
              }`}>
                {format(day, 'd')}
              </span>
              {dayOpps.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {dayOpps.slice(0, 3).map(opp => {
                    const stage = PIPELINE_STAGES.find(s => s.key === opp.stage)
                    return (
                      <div
                        key={opp.id}
                        className="hidden sm:block w-full truncate text-[10px] px-1 py-0.5 rounded"
                        style={{ backgroundColor: (stage?.hex || '#6366f1') + '20', color: stage?.hex || '#6366f1' }}
                        title={opp.title}
                      >
                        {opp.title}
                      </div>
                    )
                  })}
                  {dayOpps.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{dayOpps.length - 3}</span>
                  )}
                  {/* Mobile: just dots */}
                  <div className="flex gap-0.5 sm:hidden">
                    {dayOpps.slice(0, 4).map(opp => {
                      const stage = PIPELINE_STAGES.find(s => s.key === opp.stage)
                      return <div key={opp.id} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage?.hex || '#6366f1' }} />
                    })}
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {format(new Date(selectedDay), 'EEEE, d MMMM yyyy')}
            {selectedOpps.length > 0 && <span className="text-muted-foreground font-normal"> · {selectedOpps.length} deal{selectedOpps.length === 1 ? '' : 's'}</span>}
          </h3>
          {selectedOpps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals expected to close on this date.</p>
          ) : (
            <div className="space-y-2">
              {selectedOpps.map(opp => {
                const stage = PIPELINE_STAGES.find(s => s.key === opp.stage)
                const contact = opp.contacts
                  ? [opp.contacts.first_name, opp.contacts.last_name].filter(Boolean).join(' ')
                  : null
                return (
                  <div key={opp.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage?.hex || '#6366f1' }} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{opp.title}</p>
                        {contact && <p className="text-xs text-muted-foreground">{contact}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">
                        £{((opp.value_pence || 0) / 100).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase">{stage?.label || opp.stage}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
