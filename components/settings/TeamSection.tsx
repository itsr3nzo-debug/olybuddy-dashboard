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

interface TeamLimit {
  plan: string
  cap: number | 'unlimited'
  label: string
}

interface InviteResponse {
  success?: boolean
  userId?: string
  email?: string
  role?: string
  emailSent?: boolean
  inviteUrl?: string
  error?: string
  /** Returned by /api/team/invite when the request is rejected for hitting the plan cap. */
  plan?: string
  cap?: number | 'unlimited'
  current?: number
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  super_admin: <Shield size={14} className="text-purple-500" />,
  owner: <Crown size={14} className="text-amber-500" />,
  member: <User size={14} className="text-muted-foreground" />,
}

export default function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [limit, setLimit] = useState<TeamLimit | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copiedInviteUrl, setCopiedInviteUrl] = useState<string | null>(null)
  const [pendingRowAction, setPendingRowAction] = useState<{ id: string; kind: 'remove' | 'resend' | 'role' } | null>(null)

  // Load the current user id + the team list (+ plan cap) in parallel.
  // The user id is used to hide the viewer themselves from their own team
  // list — showing yourself in "Team Members" was a pre-existing bug.
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
      // Back-compat: the old API returned a bare array, the new one
      // returns { members, count, limit }. Handle both so a stale cached
      // bundle against a new API (or vice versa) doesn't blank the list.
      if (Array.isArray(listRes)) {
        setMembers(listRes)
      } else if (listRes && Array.isArray(listRes.members)) {
        setMembers(listRes.members)
        if (listRes.limit) setLimit(listRes.limit as TeamLimit)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Server-authoritative count is members.length (all seats on this client).
  const seatsUsed = members.length
  const atCap = limit ? (limit.cap === 'unlimited' ? false : seatsUsed >= (limit.cap as number)) : false

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

  async function handleRoleChange(member: TeamMember, newRole: 'member' | 'owner') {
    if (newRole === member.role) return
    // Promotion is the high-trust action — require a confirm so an
    // accidental click on the dropdown doesn't quietly hand someone
    // settings + billing access. Demotion is less risky but still
    // worth a prompt so owners don't surprise each other.
    const verb = newRole === 'owner' ? 'promote' : 'change'
    const consequence = newRole === 'owner'
      ? `They will gain full access: settings, billing, integrations, and the ability to invite or remove other teammates.`
      : `They will lose settings, billing, and integrations access. They can still view the dashboard.`
    const ok = window.confirm(
      `${verb === 'promote' ? 'Promote' : 'Change role for'} ${member.email} to ${newRole}?\n\n${consequence}`,
    )
    if (!ok) return
    setPendingRowAction({ id: member.id, kind: 'role' })
    setError('')
    setSuccess('')
    // Optimistic UI: flip the role locally, roll back on failure.
    const previousRole = member.role
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m))
    const res = await fetch(`/api/team/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.success) {
      setSuccess(`${member.email} is now ${newRole === 'owner' ? 'an owner' : 'a member'}`)
    } else {
      // Rollback
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: previousRole } : m))
      setError(data.error || 'Failed to change role')
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
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-lg font-semibold">Team members</h3>
        {limit && (
          <span
            className={
              atCap
                ? 'text-xs font-medium px-2 py-1 rounded-full bg-amber-500/10 text-amber-600'
                : 'text-xs text-muted-foreground px-2 py-1'
            }
          >
            {limit.cap === 'unlimited'
              ? `${seatsUsed} seats used`
              : `${seatsUsed} of ${limit.cap} seats used`}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Invite teammates to view the dashboard. Members can see conversations, calls, and pipeline
        but can&apos;t change settings or billing. Owners can.
      </p>

      {/* Member list */}
      <div className="space-y-2 mb-6">
        {visibleMembers.map(m => {
          const isPending = !m.last_sign_in_at && m.role === 'member'
          const rowBusy = pendingRowAction?.id === m.id
          const roleEditable = m.role !== 'super_admin'
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                {ROLE_ICONS[m.role] ?? ROLE_ICONS.member}
                <span className="text-sm truncate">{m.email}</span>
                {isPending && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-medium flex-shrink-0">
                    Pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground hidden md:inline">
                  {m.last_sign_in_at
                    ? `Last seen ${new Date(m.last_sign_in_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : 'Never signed in'}
                </span>
                {roleEditable ? (
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m, e.target.value as 'member' | 'owner')}
                    disabled={rowBusy}
                    aria-label={`Change role for ${m.email}`}
                    className="text-xs rounded-md border bg-background px-2 py-1 disabled:opacity-50"
                  >
                    <option value="member">Member</option>
                    <option value="owner">Owner</option>
                  </select>
                ) : (
                  <span className="text-xs text-muted-foreground capitalize px-2 py-1">
                    {m.role.replace('_', ' ')}
                  </span>
                )}
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
          placeholder={atCap ? 'At capacity — upgrade to invite more' : 'teammate@company.com'}
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-60"
          disabled={atCap}
          required
        />
        <button
          type="submit"
          disabled={loading || atCap}
          title={atCap ? 'Upgrade your plan to invite more teammates' : undefined}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {loading ? 'Inviting…' : 'Send invite'}
        </button>
      </form>

      {atCap && (
        <p className="text-xs text-muted-foreground mt-2">
          Your {limit?.plan} plan is capped at {limit?.label}. Upgrade in billing to add more seats.
        </p>
      )}

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
