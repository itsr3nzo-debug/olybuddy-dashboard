import { type ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
}

const PADDING = {
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
}

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`rounded-xl border border-border bg-card ${PADDING[padding]} ${className}`}>
      {children}
    </div>
  )
}

interface SectionProps {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}

export function Section({ title, description, children, action, className = '' }: SectionProps) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}
