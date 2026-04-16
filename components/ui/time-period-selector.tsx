'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface TimePeriodSelectorProps {
  value: string
  onChange?: (period: string) => void
  options?: { value: string; label: string }[]
}

const DEFAULT_OPTIONS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
]

export function TimePeriodSelector({ value, onChange, options = DEFAULT_OPTIONS }: TimePeriodSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleClick(period: string) {
    if (onChange) {
      onChange(period)
    } else {
      const params = new URLSearchParams(searchParams.toString())
      if (period === '7d') {
        params.delete('period')
      } else {
        params.set('period', period)
      }
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    }
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => handleClick(opt.value)}
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
