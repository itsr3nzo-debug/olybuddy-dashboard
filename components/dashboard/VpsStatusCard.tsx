'use client'

/**
 * VpsStatusCard — the moat play.
 *
 * Every UK competitor in the AI-receptionist space (ARROW, TradesBooked,
 * Sophiie, Team-Connect) is multi-tenant — they call a shared LLM and
 * ship customers a portal that ANY of them could rebrand and resell.
 * Nexley is the only product where every paying customer gets a real,
 * sandboxed, single-tenant Hetzner VPS running an actual Claude agent
 * with their own Composio MCP tools wired in.
 *
 * That's an architecture moat that competitors can't copy in a sprint.
 * The dashboard should SHOW it.
 *
 * Visual treatment — Vercel-tier dev-tool confidence:
 *   - Inline status row (not a card) at the top of the dashboard
 *   - Mono hostname + IP (`varley-electrical-ltd · 178.104.200.155`)
 *   - Live status dot (green pulse)
 *   - Uptime in mono
 *   - Inline "Restart" + "View logs" actions on hover
 *
 * Hidden when `vpsReady=false` (still provisioning) or when the user is
 * on a free demo without a VPS — those have their own provisioning
 * banner above.
 */

import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { StatusDot } from '@/components/ui/status-dot'
import { cn } from '@/lib/utils'

interface VpsStatusCardProps {
  agentName: string
  /** VPS hostname from Supabase clients.vps_service_slug */
  hostname: string | null
  /** VPS IP from Supabase clients.vps_ip */
  ip: string | null
  /** ISO when vps_ready first flipped true */
  readyAt: string | null
  /** Whether the heartbeat is currently fresh (<3min stale) */
  isLive: boolean
}

function formatUptime(readyAt: string | null): string {
  if (!readyAt) return '—'
  const ms = Date.now() - new Date(readyAt).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export default function VpsStatusCard({
  agentName,
  hostname,
  ip,
  readyAt,
  isLive,
}: VpsStatusCardProps) {
  // Re-render every 60s so the uptime stays fresh without a server fetch
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!hostname || !ip) return null

  const uptime = formatUptime(readyAt)

  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 mb-6 px-4 h-11',
        'rounded-md border border-border bg-card',
        // Hairline strip on the left in success when live, muted otherwise
        isLive
          ? 'shadow-[inset_2px_0_0_0_var(--brand-success)]'
          : 'shadow-[inset_2px_0_0_0_var(--muted-foreground)]',
        'transition-colors hover:bg-muted/30',
      )}
      role="status"
      aria-label={`${agentName} VPS status`}
    >
      {/* Live status pip */}
      <StatusDot status={isLive ? 'live' : 'offline'} size="default" />

      {/* Agent name + verbiage */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-foreground tracking-tight">
          {agentName}
        </span>
        <span
          className={cn(
            'text-xs font-medium',
            isLive ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {isLive ? 'is online' : 'is offline'}
        </span>
      </div>

      {/* Vertical rule separator */}
      <span className="h-4 w-px bg-border" aria-hidden />

      {/* Mono hostname · ip — the dev-tool flex */}
      <code className="font-mono text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1.5 min-w-0 truncate">
        <span className="truncate">{hostname}</span>
        <span className="text-muted-foreground/50">·</span>
        <span>{ip}</span>
      </code>

      {/* Uptime mono — pushed right */}
      <div className="ml-auto flex items-center gap-3">
        {readyAt && (
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity size={12} strokeWidth={1.5} aria-hidden />
            <span className="font-mono tabular-nums">{uptime}</span>
          </span>
        )}

        {/*
          Inline actions — design-time only.
          REMOVED for now: the Restart + View Logs buttons rendered but
          had no onClick wiring (no /api/admin/vps/restart endpoint, no
          logs viewer). DA flagged that buttons-that-don't-work are
          worse than no buttons. Re-introduce when the back-end ships
          and copy the same styling pattern from the VpsStatusCard
          comment block above this section.
        */}
      </div>
    </div>
  )
}
