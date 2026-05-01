'use client'

/**
 * Compound-credential connect modal — used by providers whose `compoundPat`
 * config is set in lib/integrations-config.ts (e.g. WordPress: site URL +
 * username + application password).
 *
 * The modal renders one input per field, performs lightweight client-side
 * validation, then POSTs to provider.compoundPat.validateEndpoint. The server
 * route does the real validation against the live provider API.
 */

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProviderConfig } from '@/lib/integrations-config'

interface CompoundPatModalProps {
  provider: ProviderConfig
  onClose: () => void
  onConnected: (info: { account_name?: string; account_email?: string }) => void
}

function clientValidate(field: string, value: string, kind: string | undefined, optional: boolean): string | null {
  // Optional fields (e.g. IMAP host that auto-derives from domain) are
  // allowed to be empty — skip validation entirely.
  if (!value.trim()) {
    return optional ? null : `${field} is required`
  }
  if (kind === 'url') {
    try {
      const u = new URL(value)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return 'URL must start with http:// or https://'
      }
    } catch {
      return 'Not a valid URL'
    }
  }
  if (kind === 'email') {
    // Lightweight RFC-ish check. Server validates more strictly.
    if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value)) {
      return 'Not a valid email address'
    }
  }
  if (kind === 'hostname') {
    // Bare hostname (no scheme, no path). Accept letters, digits, dots, hyphens.
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(value)) {
      return 'Not a valid hostname'
    }
  }
  if (kind === 'username') {
    if (!/^[a-zA-Z0-9._@-]{1,60}$/.test(value)) {
      return 'Username contains invalid characters'
    }
  }
  if (kind === 'wp_app_password') {
    const stripped = value.replace(/\s+/g, '')
    if (stripped.length !== 24) {
      return 'WordPress application password should be 24 characters (with or without spaces)'
    }
  }
  return null
}

export default function CompoundPatModal({
  provider,
  onClose,
  onConnected,
}: CompoundPatModalProps) {
  const cfg = provider.compoundPat!
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(cfg.fields.map(f => [f.key, ''])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string>('')
  const [submitDetail, setSubmitDetail] = useState<string>('')

  function setField(key: string, value: string) {
    setValues(v => ({ ...v, [key]: value }))
    // Clear error on the changed field as the user types.
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n })
  }

  async function handleSubmit() {
    setSubmitError(''); setSubmitDetail('')
    // Client-side validation first.
    const newErrors: Record<string, string> = {}
    for (const f of cfg.fields) {
      // Field is optional if its label or helpText hints "(optional)" or "Leave blank".
      // Cleaner would be a `required: boolean` field on CompoundPatField — adding
      // here as the lightest fix. Detected from helpText/label conventions.
      const optional = /\(optional\)/i.test(f.label) || /leave blank/i.test(f.helpText ?? '')
      const err = clientValidate(f.label, values[f.key] ?? '', f.validate, optional)
      if (err) newErrors[f.key] = err
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(cfg.validateEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitError(json.error || `Connection failed (${res.status})`)
        if (json.detail) setSubmitDetail(json.detail)
        return
      }
      onConnected({
        account_name: json.account_name,
        account_email: json.account_email,
      })
      onClose()
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md w-[90vw] p-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>Connect {provider.name}</DialogTitle>
        </DialogHeader>
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            {provider.description}.{' '}
            <a
              href={cfg.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand-accent underline hover:no-underline"
            >
              How do I get these?
            </a>
          </p>

          {cfg.fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                {field.label}
              </label>
              <input
                type={field.type === 'password' ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder ?? ''}
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                className={`w-full px-3 py-2 rounded-lg border ${
                  errors[field.key] ? 'border-destructive' : 'border-border'
                } bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-accent/30`}
              />
              {field.helpText && !errors[field.key] && (
                <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
              )}
              {errors[field.key] && (
                <p className="text-[11px] text-destructive">{errors[field.key]}</p>
              )}
            </div>
          ))}

          {submitError && (
            <div className="px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive font-medium">{submitError}</p>
              {submitDetail && (
                <p className="text-[11px] text-destructive/80 mt-1">{submitDetail}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-2 bg-brand-accent text-white text-sm rounded-lg font-medium hover:bg-brand-accent/90 disabled:opacity-50"
            >
              {submitting ? 'Validating…' : 'Connect'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
