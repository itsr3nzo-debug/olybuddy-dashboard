'use client'

import { useState } from 'react'

interface PeakHoursHeatmapProps {
  data: number[][] // 7 days × 24 hours
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function getIntensity(count: number, max: number): string {
  if (count === 0 || max === 0) return 'bg-muted/30'
  const pct = count / max
  if (pct > 0.75) return 'bg-brand-primary'
  if (pct > 0.5) return 'bg-brand-primary/70'
  if (pct > 0.25) return 'bg-brand-primary/40'
  return 'bg-brand-primary/20'
}

export default function PeakHoursHeatmap({ data }: PeakHoursHeatmapProps) {
  const [tooltip, setTooltip] = useState<string | null>(null)
  const max = Math.max(...data.flat())

  if (max === 0) {
    return <p className="text-sm text-muted-foreground">Peak hours will appear after more calls are logged.</p>
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Hour labels */}
        <div className="flex pl-10 mb-1">
          {HOURS.filter(h => h % 3 === 0).map(h => (
            <div key={h} className="text-[10px] text-muted-foreground" style={{ width: `${100/8}%` }}>
              {h}:00
            </div>
          ))}
        </div>
        {/* Grid */}
        {DAYS.map((day, dayIdx) => (
          <div key={day} className="flex items-center gap-1 mb-1">
            <span className="text-xs text-muted-foreground w-8 text-right">{day}</span>
            <div className="flex-1 flex gap-[2px]">
              {HOURS.map(hour => {
                const count = data[dayIdx][hour]
                return (
                  <div
                    key={hour}
                    className={`flex-1 h-5 rounded-sm transition-colors ${getIntensity(count, max)}`}
                    onMouseEnter={() => setTooltip(`${day} ${hour}:00 — ${count} call${count !== 1 ? 's' : ''}`)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
            </div>
          </div>
        ))}
        {tooltip && (
          <p className="text-xs text-muted-foreground mt-2 text-center">{tooltip}</p>
        )}
      </div>
    </div>
  )
}
