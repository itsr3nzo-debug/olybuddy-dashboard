'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Upload, FileText, Loader2, TrendingUp, TrendingDown } from 'lucide-react'

type EstimateRow = {
  id: string
  title: string
  created_at: string
  estimated_total_gbp: number | null
  actual_total_gbp: number | null
  margin_delta_pct: number | null
  status: string
  takeoff_confidence: number | null
  source_pages: number | null
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  owner_review: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  sent_to_client: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  won: 'bg-green-500/10 text-green-400 border-green-500/30',
  lost: 'bg-red-500/10 text-red-400 border-red-500/30',
  withdrawn: 'bg-muted/20 text-muted-foreground border-border',
}

export default function EstimatesList({ initial }: { initial: EstimateRow[] }) {
  const [rows, setRows] = useState(initial)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [title, setTitle] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function onUpload() {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    if (!title.trim()) {
      setUploadErr('Give it a title first (e.g. "Oakhurst 6 flats")')
      return
    }
    setUploading(true)
    setUploadErr('')
    try {
      const form = new FormData()
      form.append('file', f)
      form.append('title', title.trim())
      const res = await fetch('/api/estimates', { method: 'POST', credentials: 'include', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'upload failed')
      setRows(prev => [json.estimate, ...prev])
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: unknown) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload box */}
      <div className="rounded-xl border bg-card-bg p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 rounded-lg bg-brand-accent/10 p-2 text-brand-accent">
            <Upload size={16} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">New estimate</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a PDF plan or spec (max 50MB). Claude vision will draft the take-off; you review before sending.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Job title — e.g. Oakhurst 6 flats + 2 houses"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="text-sm text-muted-foreground flex-1"
          />
          <button
            onClick={onUpload}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-white hover:bg-brand-accent/90 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Processing…' : 'Upload & draft'}
          </button>
        </div>
        {uploadErr && <p className="text-xs text-brand-danger mt-2">{uploadErr}</p>}
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          ⚠ Draft only — AI-generated take-off is ~90–95% accurate on clean sheets, much worse on dense renovation plans.
          Cable-run metres are NOT measured. Every line needs your sign-off.
        </p>
      </div>

      {/* List */}
      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card-bg p-10 text-center">
          <FileText size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No estimates yet</p>
          <p className="text-xs text-muted-foreground mt-1">Upload a plan PDF above to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <Link
              key={r.id}
              href={`/estimates/${r.id}`}
              className="flex items-center justify-between rounded-xl border bg-card-bg p-4 hover:bg-muted/10 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">{r.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLOR[r.status] || STATUS_COLOR.draft}`}>
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  {r.source_pages && <span>{r.source_pages} pages</span>}
                  {r.takeoff_confidence != null && (
                    <span className={r.takeoff_confidence < 0.75 ? 'text-amber-400' : ''}>
                      Confidence {(r.takeoff_confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                {r.estimated_total_gbp != null && (
                  <div className="text-sm font-medium text-foreground">
                    £{Number(r.estimated_total_gbp).toLocaleString()}
                  </div>
                )}
                {r.margin_delta_pct != null && (
                  <div className={`text-xs inline-flex items-center gap-0.5 ${r.margin_delta_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {r.margin_delta_pct >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {r.margin_delta_pct > 0 ? '+' : ''}{r.margin_delta_pct.toFixed(0)}%
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
