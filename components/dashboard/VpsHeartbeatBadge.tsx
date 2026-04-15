'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Activity, AlertCircle } from 'lucide-react'

interface Heartbeat {
  status: string
  whatsapp_connected: boolean
  timestamp: string
}

/**
 * Realtime indicator of the VPS agent's heartbeat. Goes red if no
 * heartbeat in >3 min (agent likely crashed). The VPS health-check.sh
 * writes here every minute via the agents_heartbeats table.
 */
export default function VpsHeartbeatBadge({ clientSlug }: { clientSlug?: string }) {
  const [hb, setHb] = useState<Heartbeat | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const supabase = createClient()
    async function fetchHb() {
      let q = supabase
        .from('agent_heartbeats')
        .select('status, whatsapp_connected, timestamp')
        .order('timestamp', { ascending: false })
        .limit(1)
      if (clientSlug) q = q.eq('agent_slug', clientSlug)
      const { data } = await q
      if (mounted) {
        setHb((data && data[0]) || null)
        setLoading(false)
      }
    }
    fetchHb()
    const id = setInterval(fetchHb, 30000) // refresh every 30s
    return () => { mounted = false; clearInterval(id) }
  }, [clientSlug])

  if (loading) return null

  if (!hb) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-slate-700/30 text-slate-400">
        <AlertCircle size={12} /> No heartbeat
      </span>
    )
  }

  const ageMs = Date.now() - new Date(hb.timestamp).getTime()
  const ageMin = Math.floor(ageMs / 60000)
  const stale = ageMs > 3 * 60 * 1000 // >3 min
  const waOk = hb.whatsapp_connected

  if (stale) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-red-900/30 text-red-300" title={`Last heartbeat ${ageMin}min ago`}>
        <AlertCircle size={12} /> Agent offline · {ageMin}m
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
        waOk ? 'bg-emerald-900/30 text-emerald-300' : 'bg-amber-900/30 text-amber-300'
      }`}
      title={waOk ? 'Agent + WhatsApp live' : 'Agent up but WhatsApp disconnected'}
    >
      <Activity size={12} className={waOk ? 'animate-pulse' : ''} />
      {waOk ? 'Live' : 'WhatsApp offline'}
    </span>
  )
}
