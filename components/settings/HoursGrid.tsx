'use client'

import { useState } from 'react'
import { updateAgentConfig } from '@/app/(dashboard)/settings/actions'
import { toast } from 'sonner'
import type { HoursConfig } from '@/lib/types'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}`
})

interface HoursGridProps {
  initialHours: HoursConfig
}

export default function HoursGrid({ initialHours }: HoursGridProps) {
  const [hours, setHours] = useState<HoursConfig>(initialHours)
  const [saving, setSaving] = useState(false)

  function updateDay(day: string, field: 'open' | 'close', value: string) {
    setHours(prev => {
      const current = prev[day]
      if (current === 'closed') return prev
      return { ...prev, [day]: { ...current, [field]: value } }
    })
  }

  function toggleClosed(day: string) {
    setHours(prev => {
      if (prev[day] === 'closed') {
        return { ...prev, [day]: { open: '09:00', close: '17:00' } }
      }
      return { ...prev, [day]: 'closed' }
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('hours', JSON.stringify(hours))
      await updateAgentConfig(fd)
      toast.success('Operating hours saved')
    } catch (e) {
      toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {DAYS.map(day => {
        const isClosed = hours[day] === 'closed'
        const dayHours = isClosed ? null : (hours[day] as { open: string; close: string })

        return (
          <div key={day} className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-foreground w-24">{DAY_LABELS[day]}</span>
            <button
              onClick={() => toggleClosed(day)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isClosed
                  ? 'bg-brand-danger/10 text-brand-danger'
                  : 'bg-brand-success/10 text-brand-success'
              }`}
            >
              {isClosed ? 'Closed' : 'Open'}
            </button>
            {!isClosed && dayHours && (
              <div className="flex items-center gap-2">
                <select
                  value={dayHours.open}
                  onChange={e => updateDay(day, 'open', e.target.value)}
                  className="px-2 py-1 rounded-md border text-xs bg-card-bg text-foreground border-border"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">to</span>
                <select
                  value={dayHours.close}
                  onChange={e => updateDay(day, 'close', e.target.value)}
                  className="px-2 py-1 rounded-md border text-xs bg-card-bg text-foreground border-border"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving...' : 'Save Hours'}
      </button>
    </div>
  )
}
