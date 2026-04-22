'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react'

export interface ClientRow {
  id: string
  name: string | null
  slug: string
  subscription_status: string | null
  trial_ends_at: string | null
}

interface TrialBadge {
  label: string
  tone: 'expired' | 'urgent' | 'normal'
}

export default function ClientListSection({
  title,
  clients,
  withTrialBadges,
  trialStatusFor,
}: {
  title: string
  clients: ClientRow[]
  withTrialBadges?: boolean
  trialStatusFor?: (c: ClientRow) => TrialBadge | undefined
}) {
  if (clients.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="mb-8"
    >
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title} ({clients.length})
        </h2>
        <span className="h-px flex-1 bg-border/50" />
      </div>
      <div className="space-y-2">
        {clients.map((client, i) => {
          const badge = withTrialBadges && trialStatusFor ? trialStatusFor(client) : undefined
          return (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              whileHover={{ y: -1 }}
            >
              <Link
                href={`/admin/close/${client.id}`}
                className="group flex items-center justify-between rounded-xl border border-border/70 hover:border-purple-500/60 bg-card hover:bg-accent/30 hover:shadow-md hover:shadow-purple-500/5 transition-all duration-200 px-5 py-4"
              >
                <div className="flex flex-col min-w-0 gap-0.5">
                  <span className="text-base font-semibold truncate group-hover:text-purple-500 transition-colors">
                    {client.name || client.slug}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="font-mono">{client.slug}</span>
                    <span className="opacity-40">·</span>
                    <span className="capitalize">{client.subscription_status ?? 'unknown'}</span>
                  </span>
                </div>

                <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                  {badge && (
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
                        badge.tone === 'expired'
                          ? 'bg-red-500/15 text-red-500 dark:text-red-400'
                          : badge.tone === 'urgent'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 animate-pulse'
                            : 'bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      {badge.tone === 'expired' && <AlertCircle size={12} />}
                      {badge.tone === 'normal' && <CheckCircle2 size={12} />}
                      {badge.label}
                    </span>
                  )}
                  <ChevronRight
                    size={18}
                    className="text-muted-foreground group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all"
                  />
                </div>
              </Link>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
