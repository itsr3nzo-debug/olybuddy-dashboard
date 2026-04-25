'use client'

/**
 * ReferralCard — surfaces the referral program (#14) on the dashboard.
 *
 * Renders the user's share URL, copy button, current pending/credited
 * counts, total saved, and progress toward a "free month" (4 credits).
 * Reads from /api/referrals/me on mount and after a refetch event.
 */

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Gift, Copy, Check, Users, Sparkles } from 'lucide-react'

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
    return () => { cancelled = true }
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
    } catch { /* clipboard blocked */ }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-500/5 backdrop-blur-sm p-5 sm:p-6"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Gift size={18} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white">
            Refer a business, save £150
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Each referred customer who pays their first month gets you £150 off your next invoice. Refer 4 = a free month.
          </p>
        </div>
      </div>

      {/* Share link */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={stats.shareUrl}
          readOnly
          onFocus={e => e.target.select()}
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-xs sm:text-sm text-slate-200 font-mono"
        />
        <button
          type="button"
          onClick={copy}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-medium transition"
        >
          {copied ? <><Check size={14} />Copied</> : <><Copy size={14} />Copy</>}
        </button>
      </div>

      {/* Progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Progress to free month</span>
          <span className="text-emerald-300 font-medium">{progress}/4 credits</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-2 rounded-full transition-colors ${i < progress ? 'bg-emerald-500/70' : 'bg-white/5'}`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 pt-3 mt-1 border-t border-white/5">
          <Stat label="Pending" value={stats.count.pending} icon={<Users size={12} />} />
          <Stat label="Credited" value={stats.count.credited} icon={<Check size={12} />} />
          <Stat label="Saved" value={`£${totalSaved}`} icon={<Sparkles size={12} />} />
        </div>
      </div>
    </motion.div>
  )
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-emerald-400 text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-base font-semibold text-white">{value}</div>
    </div>
  )
}
