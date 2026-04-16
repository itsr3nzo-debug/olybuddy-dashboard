interface BadgeProps {
  label: string
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'
  size?: 'sm' | 'md'
}

const VARIANTS = {
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  neutral: 'bg-muted text-muted-foreground border-border',
  brand: 'bg-brand-primary/10 text-brand-primary border-brand-primary/20',
}

const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
}

export function Badge({ label, variant = 'neutral', size = 'sm' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center font-semibold rounded-full border ${VARIANTS[variant]} ${SIZES[size]}`}>
      {label}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    completed: { label: 'Answered', variant: 'success' },
    connected: { label: 'Connected', variant: 'success' },
    active: { label: 'Active', variant: 'success' },
    trial: { label: 'Trial', variant: 'info' },
    failed: { label: 'Failed', variant: 'danger' },
    no_answer: { label: 'Missed', variant: 'warning' },
    voicemail: { label: 'Voicemail', variant: 'info' },
    busy: { label: 'Busy', variant: 'danger' },
    pending: { label: 'Pending', variant: 'neutral' },
    offline: { label: 'Offline', variant: 'neutral' },
    online: { label: 'Online', variant: 'success' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge label={label} variant={variant} />
}

export function DirectionBadge({ direction }: { direction: string }) {
  return (
    <Badge
      label={direction === 'inbound' ? 'Inbound' : 'Outbound'}
      variant={direction === 'inbound' ? 'brand' : 'success'}
    />
  )
}
