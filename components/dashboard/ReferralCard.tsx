'use client'

/**
 * ReferralCard — v2.
 *
 * Stripped of:
 * - Emerald gradient background + backdrop-blur (glassmorphism over a
 *   flat color = AI tell)
 * - Coloured Gift icon tile (was 40×40 rounded-xl bg-emerald-500/15)
 * - Sparkles icon on the "Saved" stat (banned)
 * - rounded-2xl
 *
 * Replaced with:
 * - Plain card (8px hairline-bordered) — no gradient
 * - Title + description as a simple two-line header
 * - Share URL kept as a mono input with Copy button
 * - Progress dots in a more restrained mono treatment
 * - Stats row with no icons, just label + mono value
 *
 * Same data wiring (api/referrals/me + clipboard copy + 4-credit
 * progress) — only chrome is rebuilt.
 */

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Stats {
  code: string | null
  shareUrl: string
  count: { total: number; pending: number; credited: number }
  totalSavedPence: number
  toNextFreeMonth: number
}

export default function ReferralCard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch('/api/referrals/me', { cache: 'no-store' })
        if (!r.ok) {
          if (!cancelled) setError('Couldn\u2019t load your referral details.')
          return
        }
        const data = await r.json()
        if (!cancelled) setStats(data)
      } catch {
        if (!cancelled) setError('Network error.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return null
  if (!stats || !stats.code) return null

  const credited = stats.count.credited
  const progress = Math.min(4, credited)
  const totalSaved = (stats.totalSavedPence / 100).toFixed(0)

  async function copy() {
    if (!stats?.shareUrl) return
    try {
      await navigator.clipboard.writeText(stats.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      {/* Header */}
      <div className="mb-4 pb-3 border-b border-border">
        <h3 className="text-base font-semibold text-foreground tracking-tight">
          Refer a business, save £150
        </h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Each referred customer who pays their first month gets you £150 off your next invoice. Four referrals = a free month.
        </p>
      </div>

      {/* Share link */}
      <div className="flex items-stretch gap-2 mb-5">
        <input
          type="text"
          value={stats.shareUrl}
          readOnly
          onFocus={(e) => e.target.select()}
          className={cn(
            'flex-1 min-w-0 h-9 px-3 rounded-sm bg-transparent border border-input',
            'font-mono text-xs text-foreground',
            'focus:outline-none focus:border-primary',
          )}
        />
        <button
          type="button"
          onClick={copy}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border',
            'border-border text-muted-foreground hover:text-foreground hover:bg-muted/60',
            'text-xs font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {copied ? (
            <>
              <Check size={12} strokeWidth={1.75} />
              Copied
            </>
          ) : (
            <>
              <Copy size={12} strokeWidth={1.75} />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Progress */}
      <div className="space-y-2.5 mb-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress to free month</span>
          <span className="font-mono tabular-nums text-foreground">
            {progress}/4 credits
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-colors',
                i < progress ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <Stat label="Pending" value={stats.count.pending} />
        <Stat label="Credited" value={stats.count.credited} />
        <Stat label="Saved" value={`£${totalSaved}`} />
      </div>
    </motion.section>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <p className="font-mono tabular-nums text-base font-semibold text-foreground mt-0.5">
        {value}
      </p>
    </div>
  )
}
