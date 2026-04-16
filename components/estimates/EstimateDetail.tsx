'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Loader2, Save, Send } from 'lucide-react'

type Estimate = {
  id: string
  title: string
  created_at: string
  source_pdf_url: string | null
  source_pages: number | null
  takeoff_json: Record<string, number>
  takeoff_confidence: number | null
  takeoff_review_notes: string | null
  pricing_json: {
    by_item?: Array<{ item: string; qty: number; line_material_gbp: number; labour_mins: number; line_labour_gbp: number; tier: string }>
    totals?: { materials_gbp: number; labour_hours: number; labour_gbp: number; subtotal_gbp: number; loading_gbp: number; total_gbp: number }
    assumptions?: string[]
  }
  estimated_total_gbp: number | null
  status: string
}

export default function EstimateDetail({ initial }: { initial: Estimate }) {
  const [est, setEst] = useState(initial)
  const [takeoff, setTakeoff] = useState(initial.takeoff_json || {})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const dirty = JSON.stringify(takeoff) !== JSON.stringify(est.takeoff_json)

  function updateCount(item: string, val: string) {
    const n = parseInt(val, 10)
    setTakeoff(prev => ({ ...prev, [item]: Number.isNaN(n) ? 0 : n }))
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/estimates/${est.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takeoff_json: takeoff, recompute_pricing: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'save failed')
      setEst(json.estimate)
      setTakeoff(json.estimate.takeoff_json || {})
      setMsg('Saved + re-priced.')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(status: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/estimates/${est.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (res.ok) setEst(json.estimate)
    } finally {
      setSaving(false)
    }
  }

  const confidencePct = est.takeoff_confidence != null ? Math.round(est.takeoff_confidence * 100) : null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/estimates" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft size={12} /> All estimates
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{est.title}</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Uploaded {new Date(est.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          {est.source_pages && ` · ${est.source_pages} pages`}
          {confidencePct != null && ` · Confidence ${confidencePct}%`}
        </p>
      </div>

      {/* Disclaimer banner */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        <p className="font-medium mb-1">Draft take-off — review every line</p>
        <p className="text-xs text-amber-200/80 leading-relaxed">
          AI-generated from the uploaded plan. ~90–95% accurate on clean sheets, lower on dense/renovation drawings.
          Cable-run metres are NOT measured. Confirm loadings (access/OOH/rushed) and apply manually before sending to a client.
        </p>
        {est.takeoff_review_notes && (
          <p className="text-xs text-amber-200/80 leading-relaxed mt-2 border-t border-amber-500/20 pt-2">
            <strong>AI notes:</strong> {est.takeoff_review_notes}
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Take-off editor */}
        <div className="rounded-xl border bg-card-bg p-5">
          <h2 className="text-sm font-medium text-foreground mb-3">Take-off</h2>
          <div className="space-y-2">
            {Object.keys(takeoff).length === 0 ? (
              <p className="text-xs text-muted-foreground">No items extracted. Add rows below or upload a cleaner plan.</p>
            ) : (
              Object.entries(takeoff).map(([item, qty]) => (
                <div key={item} className="flex items-center gap-3">
                  <label className="flex-1 text-sm text-foreground capitalize">
                    {item.replace(/_/g, ' ')}
                  </label>
                  <input
                    type="number"
                    value={qty}
                    onChange={e => updateCount(item, e.target.value)}
                    className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm text-right"
                  />
                </div>
              ))
            )}
          </div>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-accent px-3 py-2 text-xs font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save & re-price
          </button>
          {msg && <p className="text-xs text-muted-foreground mt-2">{msg}</p>}
        </div>

        {/* Pricing summary */}
        <div className="rounded-xl border bg-card-bg p-5">
          <h2 className="text-sm font-medium text-foreground mb-3">Pricing</h2>
          {est.pricing_json?.totals ? (
            <div className="space-y-1.5 text-sm">
              <Row label="Materials" value={`£${est.pricing_json.totals.materials_gbp.toLocaleString()}`} />
              <Row label="Labour" value={`${est.pricing_json.totals.labour_hours}h × rates`} />
              <Row label="Labour £" value={`£${est.pricing_json.totals.labour_gbp.toLocaleString()}`} />
              <Row label="Subtotal" value={`£${est.pricing_json.totals.subtotal_gbp.toLocaleString()}`} muted />
              {est.pricing_json.totals.loading_gbp > 0 && (
                <Row label="Loadings" value={`£${est.pricing_json.totals.loading_gbp.toLocaleString()}`} />
              )}
              <div className="border-t border-border pt-2 mt-2 flex justify-between">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="text-sm font-semibold text-foreground">£{est.pricing_json.totals.total_gbp.toLocaleString()}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">+ VAT</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Awaiting price pass.</p>
          )}

          {est.pricing_json?.assumptions && est.pricing_json.assumptions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground mb-1">Assumptions</p>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {est.pricing_json.assumptions.map((a, i) => <li key={i}>• {a}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      {est.pricing_json?.by_item && est.pricing_json.by_item.length > 0 && (
        <div className="rounded-xl border bg-card-bg p-5">
          <h2 className="text-sm font-medium text-foreground mb-3">Line items</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 font-medium">Item</th>
                  <th className="text-right py-2 font-medium">Qty</th>
                  <th className="text-right py-2 font-medium">Material</th>
                  <th className="text-right py-2 font-medium">Labour</th>
                  <th className="text-right py-2 font-medium">Tier</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {est.pricing_json.by_item.map((li, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 capitalize">{li.item.replace(/_/g, ' ')}</td>
                    <td className="py-2 text-right">{li.qty}</td>
                    <td className="py-2 text-right">£{li.line_material_gbp.toLocaleString()}</td>
                    <td className="py-2 text-right">£{li.line_labour_gbp.toLocaleString()} ({li.labour_mins}m)</td>
                    <td className="py-2 text-right text-muted-foreground">{li.tier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="rounded-xl border bg-card-bg p-5 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Status: <span className="text-foreground font-medium capitalize">{est.status.replace(/_/g, ' ')}</span>
        </div>
        <div className="flex gap-2">
          {est.source_pdf_url && (
            <a
              href={est.source_pdf_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
            >
              <FileText size={12} /> Open PDF
            </a>
          )}
          {est.status === 'draft' || est.status === 'owner_review' ? (
            <button
              onClick={() => changeStatus('sent_to_client')}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
            >
              <Send size={12} /> Mark sent to client
            </button>
          ) : null}
          {est.status === 'sent_to_client' && (
            <>
              <button
                onClick={() => changeStatus('won')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-500/10 border border-green-500/40 text-green-400 px-3 py-1.5 text-xs font-medium hover:bg-green-500/20"
              >
                Won
              </button>
              <button
                onClick={() => changeStatus('lost')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
              >
                Lost
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
      <span className={muted ? 'text-muted-foreground' : 'text-foreground'}>{value}</span>
    </div>
  )
}
