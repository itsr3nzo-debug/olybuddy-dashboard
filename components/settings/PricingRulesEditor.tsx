'use client'

import { useEffect, useState } from 'react'
import { Save, Loader2, Plus, X } from 'lucide-react'

type Rules = {
  labour_hourly_gbp: number
  minimum_call_out_gbp: number
  markup_tiers: Record<string, number>
  loading_rules: Record<string, number>
  item_rates: Record<string, { material_gbp: number; labour_mins: number; tier: string }>
  notes: string | null
}

const DEFAULT_RULES: Rules = {
  labour_hourly_gbp: 65,
  minimum_call_out_gbp: 85,
  markup_tiers: { standard: 25, specialist: 40, heritage: 50 },
  loading_rules: {},
  item_rates: {},
  notes: null,
}

export default function PricingRulesEditor() {
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/pricing-rules', { credentials: 'include' })
        const json = await res.json()
        if (json.pricing_rules) {
          setRules({
            labour_hourly_gbp: Number(json.pricing_rules.labour_hourly_gbp ?? 65),
            minimum_call_out_gbp: Number(json.pricing_rules.minimum_call_out_gbp ?? 85),
            markup_tiers: json.pricing_rules.markup_tiers ?? DEFAULT_RULES.markup_tiers,
            loading_rules: json.pricing_rules.loading_rules ?? {},
            item_rates: json.pricing_rules.item_rates ?? {},
            notes: json.pricing_rules.notes ?? null,
          })
        }
      } finally { setLoading(false) }
    })()
  }, [])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/pricing-rules', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      })
      if (!res.ok) throw new Error('save failed')
      setMsg('Saved. Your AI Employee will use these on the next quote.')
    } catch { setMsg('Failed to save') } finally { setSaving(false) }
  }

  function updateTier(name: string, pct: number) {
    setRules(r => ({ ...r, markup_tiers: { ...r.markup_tiers, [name]: pct } }))
  }
  function addLoading() {
    const k = prompt('Loading name (e.g. no_parking, zone_1_london, out_of_hours)')
    if (!k) return
    setRules(r => ({ ...r, loading_rules: { ...r.loading_rules, [k]: 10 } }))
  }
  function removeLoading(k: string) {
    setRules(r => {
      const next = { ...r.loading_rules }
      delete next[k]
      return { ...r, loading_rules: next }
    })
  }
  function updateLoading(k: string, v: number) {
    setRules(r => ({ ...r, loading_rules: { ...r.loading_rules, [k]: v } }))
  }

  if (loading) return <div className="skeleton h-80 rounded-xl" />

  return (
    <div className="space-y-5">
      {/* Core rates */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-3">Core rates</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Labour £/hr</label>
            <input
              type="number"
              value={rules.labour_hourly_gbp}
              onChange={e => setRules(r => ({ ...r, labour_hourly_gbp: Number(e.target.value) }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Minimum call-out £</label>
            <input
              type="number"
              value={rules.minimum_call_out_gbp}
              onChange={e => setRules(r => ({ ...r, minimum_call_out_gbp: Number(e.target.value) }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Markup tiers */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-3">Markup tiers (%)</h2>
        <p className="text-xs text-muted-foreground mb-3">Applied to material cost by item type.</p>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(rules.markup_tiers).map(([name, pct]) => (
            <div key={name}>
              <label className="block text-xs text-muted-foreground mb-1 capitalize">{name}</label>
              <input
                type="number"
                value={pct}
                onChange={e => updateTier(name, Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Loadings */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-foreground">Site loadings (%)</h2>
          <button onClick={addLoading} className="inline-flex items-center gap-1 text-xs text-brand-accent">
            <Plus size={12} /> Add loading
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Percentage bumps applied to subtotal when the site conditions match. Examples: zone_1_london 10, no_parking 5, out_of_hours 50, rushed_under_7d 15.
        </p>
        {Object.keys(rules.loading_rules).length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No loadings set.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(rules.loading_rules).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-foreground font-mono">{k}</span>
                <input
                  type="number"
                  value={v}
                  onChange={e => updateLoading(k, Number(e.target.value))}
                  className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-right"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <button onClick={() => removeLoading(k)} className="text-muted-foreground hover:text-brand-danger">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Item-rate summary */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-2">Item rates</h2>
        <p className="text-xs text-muted-foreground">
          Your AI Employee starts with UK electrical defaults (socket £8.50 + 20 min labour, downlight £7.50 + 12 min, etc). Per-line edits happen on each estimate. This is on the roadmap as a full rate book editor — for now, the estimator shows defaults and you edit per-line.
        </p>
      </div>

      {/* Notes */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-3">Notes</h2>
        <textarea
          value={rules.notes ?? ''}
          onChange={e => setRules(r => ({ ...r, notes: e.target.value }))}
          placeholder="Anything the AI should know about your pricing approach — brand preferences, never-quote-below, weekend policy…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm h-24"
        />
      </div>

      <div className="rounded-xl border bg-card p-4 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{msg || 'Unsaved changes are not applied.'}</div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save rate card
        </button>
      </div>
    </div>
  )
}
