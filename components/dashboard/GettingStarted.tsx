import Link from 'next/link'
import { Phone, MessageSquare, Clock, CheckCircle } from 'lucide-react'
import { AI_PHONE_DISPLAY, AI_PHONE_NUMBER } from '@/lib/constants'

interface GettingStartedProps {
  hasGreeting: boolean
  hasHours: boolean
}

export default function GettingStarted({ hasGreeting, hasHours }: GettingStartedProps) {
  const steps = [
    {
      id: 'call',
      icon: Phone,
      label: 'Call your AI Employee',
      description: `Dial ${AI_PHONE_DISPLAY} and hear it in action`,
      done: false, // always shows as a todo — they need to call to see data
      href: `tel:${AI_PHONE_NUMBER}`,
      external: true,
    },
    {
      id: 'greeting',
      icon: MessageSquare,
      label: 'Set your greeting',
      description: 'Personalise the opening line callers hear',
      done: hasGreeting,
      href: '/settings',
      external: false,
    },
    {
      id: 'hours',
      icon: Clock,
      label: 'Configure business hours',
      description: "Tell your AI Employee when you're open",
      done: hasHours,
      href: '/settings',
      external: false,
    },
  ]

  const doneCount = steps.filter(s => s.done).length

  return (
    <div className="rounded-xl border overflow-hidden bg-card-bg mb-6">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Get Started</h2>
        <span className="text-xs text-muted-foreground">{doneCount}/{steps.length} done</span>
      </div>

      {/* Hero phone number */}
      <div className="px-5 py-6 text-center border-b border-border bg-brand-primary/5">
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Your AI Employee number</p>
        <a
          href={`tel:${AI_PHONE_NUMBER}`}
          className="text-3xl font-bold text-brand-primary tracking-wide hover:opacity-80 transition-opacity"
        >
          {AI_PHONE_DISPLAY}
        </a>
        <p className="text-xs text-muted-foreground mt-2">Call this number to see your first call appear on this dashboard</p>
      </div>

      {/* Steps */}
      <div className="divide-y divide-border">
        {steps.map(({ id, icon: Icon, label, description, done, href, external }) => (
          <div key={id} className="flex items-center gap-4 px-5 py-4">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              done ? 'bg-brand-success/15 text-brand-success' : 'bg-muted text-muted-foreground'
            }`}>
              {done ? <CheckCircle size={16} /> : <Icon size={16} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                {label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
            {!done && (
              external ? (
                <a
                  href={href}
                  className="text-xs font-medium text-brand-primary hover:underline flex-shrink-0"
                >
                  Call now →
                </a>
              ) : (
                <Link
                  href={href}
                  className="text-xs font-medium text-brand-primary hover:underline flex-shrink-0"
                >
                  Configure →
                </Link>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
