'use client'

import { useState } from 'react'

interface TimePeriodSelectorProps {
  value: string
  onChange: (period: string) => void
  options?: { value: string; label: string }[]
}

const DEFAULT_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

export function TimePeriodSelector({ value, onChange, options = DEFAULT_OPTIONS }: TimePeriodSelectorProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            value === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function useTimePeriod(initial = '7d') {
  const [period, setPeriod] = useState(initial)

  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365 * 5
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  return { period, setPeriod, days, since }
}
