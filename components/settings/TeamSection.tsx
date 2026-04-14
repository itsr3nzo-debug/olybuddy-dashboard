'use client'

import { useState, useEffect } from 'react'
import { UserPlus, Trash2, Shield, User, Crown } from 'lucide-react'

interface TeamMember {
  id: string
  email: string
  role: string
  created_at: string
  last_sign_in_at: string | null
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin: <Shield size={14} className="text-purple-500" />,
  owner: <Crown size={14} className="text-amber-500" />,
  member: <User size={14} className="text-muted-foreground" />,
}

export default function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetch('/api/team/members')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setMembers(data) })
      .catch(() => {})
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json()

    if (res.ok) {
      setSuccess(`Invite sent to ${email}`)
      setEmail('')
      setMembers(prev => [...prev, { id: data.userId, email, role: 'member', created_at: new Date().toISOString(), last_sign_in_at: null }])
    } else {
      setError(data.error || 'Failed to invite')
    }
    setLoading(false)
  }

  return (
    <div className="bg-card rounded-xl border p-6">
      <h3 className="text-lg font-semibold mb-4">Team Members</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Invite team members to view the dashboard. They can see contacts, calls, and pipeline but cannot edit settings or billing.
      </p>

      {/* Member list */}
      <div className="space-y-2 mb-6">
        {members.map(m => (
          <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              {ROLE_ICONS[m.role] ?? ROLE_ICONS.member}
              <span className="text-sm">{m.email}</span>
              <span className="text-xs text-muted-foreground capitalize">({m.role})</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {m.last_sign_in_at ? `Last seen ${new Date(m.last_sign_in_at).toLocaleDateString()}` : 'Never signed in'}
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No team members yet.</p>
        )}
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="team@company.com"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-brand-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <UserPlus size={14} />
          {loading ? 'Inviting...' : 'Invite'}
        </button>
      </form>

      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {success && <p className="text-sm text-green-500 mt-2">{success}</p>}
    </div>
  )
}
