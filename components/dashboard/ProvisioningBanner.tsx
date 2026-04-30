'use client'

/**
 * ProvisioningBanner — v2.
 *
 * Polls /api/provisioning/status every 20s while not 'live'. Renders
 * through the shared <BannerShell> primitive. State machine + polling
 * cadence preserved verbatim from v1; only the chrome was rewritten.
 */

import { useEffect, useState } from 'react'
import {
  Loader2,
  Server,
  AlertCircle,
  Smartphone,
  CreditCard,
  HelpCircle,
} from 'lucide-react'
import { BannerShell, BannerAction } from '@/components/ui/banner'
import type { LucideIcon } from 'lucide-react'

type State =
  | 'awaiting_payment'
  | 'awaiting_vps'
  | 'provisioning'
  | 'needs_pairing'
  | 'live'
  | 'attention'
  | 'unknown'

type StatusResponse = {
  state: State
  message: string
  vps_ready: boolean
  vps_ready_at: string | null
  pending_count: number
  wa_connection_status?: string
  wa_connection_name?: string | null
}

interface StateConfig {
  intent: 'info' | 'warning' | 'danger' | 'success'
  icon: LucideIcon
  /** Bold lead-in line shown before the API-supplied message */
  title: string
  /** Whether the icon should spin (for "applying changes" type states) */
  spin?: boolean
  /** Optional inline CTA — null means no button */
  cta?: { label: string; href: string }
  /** Whether the banner is dismissable */
  dismissable?: boolean
}

const STATE_CONFIG: Record<State, StateConfig | null> = {
  awaiting_payment: {
    intent: 'warning',
    icon: CreditCard,
    title: 'Complete payment to start your trial',
    cta: { label: 'Pay now', href: '/settings/billing' },
  },
  awaiting_vps: {
    intent: 'info',
    icon: Server,
    title: 'Setting up your AI Employee',
  },
  provisioning: {
    intent: 'warning',
    icon: Loader2,
    title: 'Applying changes',
    spin: true,
  },
  needs_pairing: {
    intent: 'info',
    icon: Smartphone,
    title: 'Link your WhatsApp',
    cta: { label: 'Link now', href: '/onboarding/whatsapp' },
  },
  attention: {
    intent: 'danger',
    icon: AlertCircle,
    title: 'Needs attention',
    dismissable: true,
  },
  unknown: {
    intent: 'info',
    icon: HelpCircle,
    title: 'Status unknown',
  },
  // No banner when live — return null
  live: null,
}

export default function ProvisioningBanner() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const res = await fetch('/api/provisioning/status', { credentials: 'include' })
        if (!res.ok) throw new Error('status fetch failed')
        const data: StatusResponse = await res.json()
        if (cancelled) return
        setStatus(data)
        if (data.state !== 'live') {
          timer = setTimeout(poll, 20_000)
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 30_000)
      }
    }
    poll()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!status || dismissed) return null

  const config = STATE_CONFIG[status.state]
  if (!config) return null

  return (
    <BannerShell
      intent={config.intent}
      icon={config.icon}
      onDismiss={config.dismissable ? () => setDismissed(true) : undefined}
    >
      <span className={config.spin ? 'inline-flex items-center gap-1.5' : ''}>
        <span className="font-medium text-foreground">{config.title}</span>
        <span className="text-muted-foreground ml-2">{status.message}</span>
      </span>
      {config.cta && (
        <BannerAction href={config.cta.href} intent={config.intent}>
          {config.cta.label}
        </BannerAction>
      )}
    </BannerShell>
  )
}
