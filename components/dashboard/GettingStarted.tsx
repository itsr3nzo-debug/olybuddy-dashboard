import Link from 'next/link'
import { MessageSquare, Clock, CheckCircle, Plug, Sparkles } from 'lucide-react'

interface GettingStartedProps {
  hasGreeting: boolean
  hasHours: boolean
}

export default function GettingStarted({ hasGreeting, hasHours }: GettingStartedProps) {
  const steps = [
    {
      id: 'message',
      icon: MessageSquare,
      label: 'Message your AI Employee',
      description: 'Send a WhatsApp message and watch it respond instantly',
      done: false,
      href: '#',
    },
    {
      id: 'integrations',
      icon: Plug,
      label: 'Connect your tools',
      description: 'Link Gmail, Calendar, or QuickBooks for full automation',
      done: false,
      href: '/integrations',
    },
    {
      id: 'greeting',
      icon: Sparkles,
      label: 'Personalise your AI',
      description: 'Set the greeting and tone your customers will experience',
      done: hasGreeting,
      href: '/settings',
    },
    {
      id: 'hours',
      icon: Clock,
      label: 'Set business hours',
      description: "Tell your AI Employee when you're open for bookings",
      done: hasHours,
      href: '/settings',
    },
  ]

  const doneCount = steps.filter(s => s.done).length

  return (
    <div className="rounded-xl border overflow-hidden bg-card mb-6">
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold text-foreground">Get Started</h2>
        <span className="text-xs text-muted-foreground">{doneCount}/{steps.length} done</span>
      </div>

      <div className="px-5 py-5 text-center border-b bg-brand-primary/5" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Your AI Employee is ready</p>
        <p className="text-lg font-bold text-brand-primary">Message on WhatsApp to see it in action</p>
        <p className="text-xs text-muted-foreground mt-1">Try: &quot;Hi, do you do emergency callouts?&quot;</p>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {steps.map(({ id, icon: Icon, label, description, done, href }) => (
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
              <Link href={href} className="text-xs font-medium text-brand-primary hover:underline flex-shrink-0">
                Set up →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
