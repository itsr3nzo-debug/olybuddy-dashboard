'use client'

import { useState, useEffect } from 'react'
import { UserPlus, Trash2, Shield, User, Crown, RefreshCw, Copy, Check, Loader2 } from 'lucide-react'

interface TeamMember {
  id: string
  email: string
  role: string
  created_at: string
  last_sign_in_at: string | null
}

interface InviteResponse {
  success?: boolean
  userId?: string
  email?: string
  role?: string
  emailSent?: boolean
  inviteUrl?: string
  error?: string
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin: <Shield size={14} className="text-purple-500" />,
  owner: <Crown size={14} className="text-amber-500" />,
  member: <User size={14} className="text-muted-foreground" />,
}

export default function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copiedInviteUrl, setCopiedInviteUrl] = useState<string | null>(null)
  const [pendingRowAction, setPendingRowAction] = useState<{ id: string; kind: 'remove' | 'resend' } | null>(null)

  // Load the current user id + the team list in parallel. The user id is
  // used to hide the viewer themselves from their own team list — showing
  // yourself in "Team Members" is confusing and was a pre-existing bug.
  // Read the id from the client-side Supabase session directly so we don't
  // need to add a `/api/auth/me` route just for this.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const [sessionRes, listRes] = await Promise.all([
        createClient().auth.getUser().catch(() => null),
        fetch('/api/team/members').then(r => r.json()).catch(() => null),
      ])
      if (!alive) return
      const uid = sessionRes?.data?.user?.id ?? null
      if (uid) setCurrentUserId(uid)
      if (Array.isArray(listRes)) setMembers(listRes)
    })()
    return () => {
      alive = false
    }
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    setCopiedInviteUrl(null)

    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data: InviteResponse = await res.json().catch(() => ({}))

    if (res.ok && data.success) {
      setSuccess(data.emailSent === false
        ? `Invite created but email failed to send — copy the link below and share it directly.`
        : `Invite sent to ${email}`)
      if (data.emailSent === false && data.inviteUrl) {
        setCopiedInviteUrl(data.inviteUrl)
      }
      setEmail('')
      if (data.userId) {
        setMembers(prev => [...prev, {
          id: data.userId!,
          email: data.email ?? email,
          role: 'member',
          created_at: new Date().toISOString(),
          last_sign_in_at: null,
        }])
      }
    } else {
      setError(data.error || 'Failed to invite')
    }
    setLoading(false)
  }

  async function handleRemove(member: TeamMember) {
    const ok = window.confirm(
      `Remove ${member.email} from your team?\n\nThey will immediately lose access. This cannot be undone.`,
    )
    if (!ok) return
    setPendingRowAction({ id: member.id, kind: 'remove' })
    setError('')
    setSuccess('')
    const res = await fetch(`/api/team/members/${member.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setMembers(prev => prev.filter(m => m.id !== member.id))
      setSuccess(`${member.email} removed`)
    } else {
      setError(data.error || 'Failed to remove')
    }
    setPendingRowAction(null)
  }

  async function handleResend(member: TeamMember) {
    setPendingRowAction({ id: member.id, kind: 'resend' })
    setError('')
    setSuccess('')
    setCopiedInviteUrl(null)
    const res = await fetch(`/api/team/resend/${member.id}`, { method: 'POST' })
    const data: InviteResponse = await res.json().catch(() => ({}))
    if (res.ok && data.success) {
      setSuccess(data.emailSent === false
        ? `Link regenerated but email failed to send — copy below.`
        : `Fresh invite sent to ${member.email}`)
      if (data.emailSent === false && data.inviteUrl) {
        setCopiedInviteUrl(data.inviteUrl)
      }
    } else {
      setError(data.error || 'Failed to resend')
    }
    setPendingRowAction(null)
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedInviteUrl(url + '#copied')
      setTimeout(() => setCopiedInviteUrl(url), 1500)
    } catch {
      // Fall through — user can select manually
    }
  }

  // Devils-advocate filter — exclude the current user from the list.
  // Showing yourself in "your team" is confusing (you're the admin, not a
  // member of your own team). Keep super_admins + owners in view though;
  // the owner needs to know who else has access, not just members.
  const visibleMembers = currentUserId
    ? members.filter(m => m.id !== currentUserId)
    : members

  return (
    <div className="bg-card rounded-xl border p-6">
      <h3 className="text-lg font-semibold mb-1">Team members</h3>
      <p className="text-sm text-muted-foreground mb-5">
        Invite teammates to view the dashboard. They can see conversations, calls, and pipeline
        but can&apos;t change settings or billing.
      </p>

      {/* Member list */}
      <div className="space-y-2 mb-6">
        {visibleMembers.map(m => {
          const isPending = !m.last_sign_in_at && m.role === 'member'
          const rowBusy = pendingRowAction?.id === m.id
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                {ROLE_ICONS[m.role] ?? ROLE_ICONS.member}
                <span className="text-sm truncate">{m.email}</span>
                <span className="text-xs text-muted-foreground capitalize hidden sm:inline">({m.role})</span>
                {isPending && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-medium flex-shrink-0">
                    Pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-muted-foreground hidden md:inline">
                  {m.last_sign_in_at
                    ? `Last seen ${new Date(m.last_sign_in_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : 'Never signed in'}
                </span>
                {isPending && (
                  <button
                    type="button"
                    onClick={() => handleResend(m)}
                    disabled={rowBusy}
                    title="Resend invite email"
                    aria-label="Resend invite email"
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {rowBusy && pendingRowAction?.kind === 'resend'
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RefreshCw size={12} />}
                    Resend
                  </button>
                )}
                {m.role !== 'super_admin' && (
                  <button
                    type="button"
                    onClick={() => handleRemove(m)}
                    disabled={rowBusy}
                    title="Remove from team"
                    aria-label="Remove from team"
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    {rowBusy && pendingRowAction?.kind === 'remove'
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Trash2 size={12} />}
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {visibleMembers.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No team members yet. Invite one below.</p>
        )}
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {loading ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-500 mt-3">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-500 mt-3">{success}</p>
      )}

      {/* SMTP-failure fallback — surface the raw link so the owner can
          share it over WhatsApp / SMS even if the outgoing email bounced. */}
      {copiedInviteUrl && !copiedInviteUrl.endsWith('#copied') && (
        <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="flex-1 font-mono truncate">{copiedInviteUrl}</span>
          <button
            type="button"
            onClick={() => copyLink(copiedInviteUrl)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted transition-colors"
          >
            <Copy size={12} /> Copy
          </button>
        </div>
      )}
      {copiedInviteUrl && copiedInviteUrl.endsWith('#copied') && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-green-500">
          <Check size={12} /> Copied
        </p>
      )}
    </div>
  )
}
