'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Rocket, CheckCircle2, Loader2 } from 'lucide-react'

export function DeployButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDeploy() {
    setLoading(true)
    try {
      await fetch('/api/admin/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleDeploy}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
      Deploy
    </button>
  )
}

export function MarkLiveButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleMarkLive() {
    setLoading(true)
    try {
      await fetch('/api/admin/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, vps_status_override: 'live' }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleMarkLive}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-green-900/20 text-green-400 hover:bg-green-900/40 transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
      Mark Live
    </button>
  )
}
