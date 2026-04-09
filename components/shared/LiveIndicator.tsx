import { cn } from '@/lib/utils'

interface LiveIndicatorProps {
  isConnected: boolean
  className?: string
}

export default function LiveIndicator({ isConnected, className }: LiveIndicatorProps) {
  if (!isConnected) return null

  return (
    <span
      role="status"
      aria-label="Live connection active"
      className={cn('inline-block h-2 w-2 rounded-full bg-brand-success animate-pulse-live', className)}
    />
  )
}
