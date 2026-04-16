'use client'

import { useEffect, useState } from 'react'
import { Phone, User, Smartphone, Check, AlertCircle, Save, Plus, X, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'

const UK_PHONE_RE = /^(\+?44|0)7\d{9}$/

function validPhone(input: string): boolean {
  return UK_PHONE_RE.test(input.replace(/\s/g, ''))
}

function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  if (e164.startsWith('44')) return '+' + e164
  return e164
}

type Data = {
  owner_phone: string
  owner_name: string
  business_whatsapp: string
  owner_aliases: string[]
}

export default function SenderRolesEditor() {
  const [data, setData] = useState<Data>({
    owner_phone: '',
    owner_name: '',
    business_whatsapp: '',
    owner_aliases: [],
  })
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [aliasDraft, setAliasDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/settings/sender-roles', { credentials: 'include' })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error || 'Could not load settings')
          setLoading(false)
          return
        }
        setData({
          owner_phone: formatPhone(json.owner_phone),
          owner_name: json.owner_name || '',
          business_whatsapp: formatPhone(json.business_whatsapp),
          owner_aliases: json.owner_aliases || [],
        })
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError('Network error')
          setLoading(false)
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  function update<K extends keyof Data>(field: K, value: Data[K]) {
    setData(prev => ({ ...prev, [field]: value }))
    setDirty(true)
    setError('')
    setSuccess('')
  }

  async function save() {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/settings/sender-roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          owner_phone: data.owner_phone,
          owner_name: data.owner_name,
          business_whatsapp: data.business_whatsapp,
          owner_aliases: data.owner_aliases,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to save')
      } else {
        setSuccess('Saved. Your AI Employee will pick up the changes on next restart.')
        setDirty(false)
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  function addAlias() {
    if (!validPhone(aliasDraft)) {
      setError('Alias must be a valid UK mobile')
      return
    }
    if (data.owner_aliases.includes(aliasDraft)) {
      setError('That number is already in the list')
      return
    }
    update('owner_aliases', [...data.owner_aliases, aliasDraft])
    setAliasDraft('')
  }

  function removeAlias(num: string) {
    update('owner_aliases', data.owner_aliases.filter(a => a !== num))
  }

  const bizValid = data.business_whatsapp.length === 0 || validPhone(data.business_whatsapp)
  const ownerValid = data.owner_phone.length === 0 || validPhone(data.owner_phone)
  const sameNumber = data.business_whatsapp && data.owner_phone && data.business_whatsapp.replace(/\s|\+/g, '') === data.owner_phone.replace(/\s|\+/g, '')

  if (loading) {
    return <div className="skeleton h-80 w-full rounded-xl" />
  }

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <div className="rounded-xl border border-brand-accent/20 bg-brand-accent/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-accent/10 text-brand-accent">
            <Smartphone size={16} />
          </div>
          <div className="flex-1 text-xs text-muted-foreground">
            <p className="text-sm font-medium text-foreground mb-1">How this works</p>
            <ul className="space-y-0.5">
              <li>• <strong>Business WhatsApp</strong> (eSIM) — what customers text. Your AI Employee pairs to this number.</li>
              <li>• <strong>Your personal WhatsApp</strong> — when you message the AI from here, it treats you as the boss and runs commands.</li>
              <li>• <strong>Aliases</strong> — extra owner-level numbers (a business partner, second phone, etc).</li>
              <li>• Any number NOT in this list is treated as a customer enquiry.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Business WhatsApp */}
      <div className="rounded-xl border bg-card-bg p-5">
        <label className="block text-sm font-medium text-foreground mb-1.5">
          <span className="inline-flex items-center gap-1.5">
            <Phone size={14} className="text-muted-foreground" />
            Business WhatsApp number (eSIM)
          </span>
        </label>
        <p className="text-xs text-muted-foreground mb-2">
          Customers text this number. Your AI Employee lives here. Get your eSIM from{' '}
          <a href="https://secondsim.co.uk" target="_blank" rel="noreferrer" className="text-brand-accent underline">
            secondsim.co.uk
          </a>.
        </p>
        <div className="relative">
          <input
            type="tel"
            value={data.business_whatsapp}
            onChange={e => update('business_whatsapp', e.target.value)}
            placeholder="+447xxx xxx xxx"
            className={`w-full rounded-lg border bg-background px-3 py-2 pr-9 text-sm ${
              bizValid ? 'border-border' : 'border-brand-danger/40'
            } focus:outline-none focus:ring-2 focus:ring-brand-accent/30`}
          />
          {bizValid && data.business_whatsapp && (
            <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-success" />
          )}
        </div>
      </div>

      {/* Owner personal */}
      <div className="rounded-xl border bg-card-bg p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            <span className="inline-flex items-center gap-1.5">
              <User size={14} className="text-muted-foreground" />
              Your personal WhatsApp number
            </span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            When you text the AI from here, it treats you as the owner.
          </p>
          <div className="relative">
            <input
              type="tel"
              value={data.owner_phone}
              onChange={e => update('owner_phone', e.target.value)}
              placeholder="+447xxx xxx xxx"
              className={`w-full rounded-lg border bg-background px-3 py-2 pr-9 text-sm ${
                ownerValid && !sameNumber ? 'border-border' : 'border-brand-danger/40'
              } focus:outline-none focus:ring-2 focus:ring-brand-accent/30`}
            />
            {ownerValid && !sameNumber && data.owner_phone && (
              <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-success" />
            )}
          </div>
          {sameNumber && (
            <p className="text-xs text-brand-danger mt-1">
              Must be different to your business WhatsApp number.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Your first name</label>
          <input
            type="text"
            value={data.owner_name}
            onChange={e => update('owner_name', e.target.value)}
            placeholder="Kade"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
          />
          <p className="text-xs text-muted-foreground mt-1">The AI will use this when speaking to you.</p>
        </div>
      </div>

      {/* Aliases */}
      <div className="rounded-xl border bg-card-bg p-5">
        <div className="mb-3">
          <h3 className="text-sm font-medium text-foreground">Additional owner-level numbers</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Optional. Any number added here also gets owner treatment (commands, not enquiries). Max 10.
          </p>
        </div>

        {data.owner_aliases.length > 0 ? (
          <ul className="space-y-2 mb-3">
            {data.owner_aliases.map(num => (
              <motion.li
                key={num}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="font-mono text-foreground">+{num}</span>
                <button
                  onClick={() => removeAlias(num)}
                  className="text-muted-foreground hover:text-brand-danger transition-colors"
                  aria-label={`Remove ${num}`}
                >
                  <X size={14} />
                </button>
              </motion.li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic mb-3">No additional owner numbers yet.</p>
        )}

        <div className="flex gap-2">
          <input
            type="tel"
            value={aliasDraft}
            onChange={e => setAliasDraft(e.target.value)}
            placeholder="+447xxx xxx xxx"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
          />
          <button
            onClick={addAlias}
            disabled={!aliasDraft || data.owner_aliases.length >= 10}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {/* Error / Success */}
      {error && (
        <div className="rounded-lg border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm text-brand-danger flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-brand-success/30 bg-brand-success/5 px-4 py-3 text-sm text-brand-success flex items-start gap-2">
          <Check size={16} className="mt-0.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-between rounded-xl border bg-card-bg p-4">
        <div className="text-xs text-muted-foreground">
          {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving || !bizValid || !ownerValid || sameNumber}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
