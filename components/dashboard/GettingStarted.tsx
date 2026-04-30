import Link from 'next/link'
import { MessageSquare, Clock, Check, Plug, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GettingStartedProps {
  hasGreeting: boolean
  hasHours: boolean
}

/**
 * GettingStarted — v2.
 *
 * Stripped of:
 * - Coloured circle tile (was bg-brand-success/15 with a checkmark inside)
 *   → tiny mono numbered chip, primary tint when current/incomplete
 * - "Your AI Employee is ready" hero banner inside the card → removed,
 *   that's marketing copy
 * - Sparkles icon for "personalise" → SettingsIcon (less AI cliché)
 * - rounded-xl → 8px (Card)
 *
 * Replaced with:
 * - Numbered list pattern (1 / 2 / 3 / 4) — clear sequence
 * - Active step keeps primary tint; done step is muted with a tick
 * - One inline "Set up →" link per row, no bouncy heading
 *
 * Same data shape, same hrefs — only chrome changes.
 */
export default function GettingStarted({ hasGreeting, hasHours }: GettingStartedProps) {
  const steps = [
    {
      id: 'message',
      icon: MessageSquare,
      label: 'Message your AI Employee',
      description: 'Send a WhatsApp message and see it respond.',
      done: false,
      href: '#',
    },
    {
      id: 'integrations',
      icon: Plug,
      label: 'Connect your tools',
      description: 'Link Gmail, Calendar, or QuickBooks for full automation.',
      done: false,
      href: '/integrations',
    },
    {
      id: 'greeting',
      icon: SettingsIcon,
      label: 'Personalise your AI',
      description: 'Set the greeting and tone your customers will experience.',
      done: hasGreeting,
      href: '/settings',
    },
    {
      id: 'hours',
      icon: Clock,
      label: 'Set business hours',
      description: "Tell your AI Employee when you're open for bookings.",
      done: hasHours,
      href: '/settings',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden mb-6">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">Get started</h2>
        <span className="font-mono tabular-nums text-xs text-muted-foreground">
          {doneCount}/{steps.length}
        </span>
      </header>

      <ol className="divide-y divide-border">
        {steps.map(({ id, icon: Icon, label, description, done, href }, idx) => (
          <li key={id} className="flex items-center gap-4 px-5 py-3.5">
            {/* Numbered chip — solid primary when active, muted when done */}
            <span
              aria-hidden
              className={cn(
                'shrink-0 size-6 rounded-full inline-flex items-center justify-center text-[11px] font-medium font-mono tabular-nums',
                done
                  ? 'bg-success/15 text-success'
                  : 'bg-muted text-muted-foreground border border-border',
              )}
            >
              {done ? <Check size={12} strokeWidth={2} /> : idx + 1}
            </span>

            <Icon
              aria-hidden
              size={16}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground/60"
            />

            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  'text-sm font-medium tracking-tight truncate',
                  done ? 'line-through text-muted-foreground' : 'text-foreground',
                )}
              >
                {label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {description}
              </p>
            </div>

            {!done && (
              <Link
                href={href}
                className="text-xs font-medium text-primary hover:underline whitespace-nowrap shrink-0"
              >
                Set up →
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
