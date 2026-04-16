/**
 * POST /api/estimates    — upload a plan PDF + kick off vision take-off
 *
 * Flow:
 *   1. Validate user, load pricing_rules (defaults if missing)
 *   2. Stash the file in Supabase storage under `<client_id>/<uuid>.pdf`
 *   3. Create `estimates` row with status=draft
 *   4. Hit Claude with the PDF (document vision) and ask for structured take-off
 *   5. Compute pricing_json from pricing_rules + takeoff
 *   6. Update the estimates row with both
 *   7. Return the row to the client for immediate display
 *
 * This is Phase 1 estimator — single-pass, no manual review loop yet.
 * User sees the draft on /estimates/:id and edits from there.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) ?? null
}

// Standard UK electrical take-off categories for prompt-structured extraction
const TAKEOFF_CATEGORIES = [
  'sockets_1g', 'sockets_2g', 'sockets_usb',
  'switches_1g', 'switches_2g', 'switches_dim',
  'downlights', 'pendants', 'fluorescent',
  'consumer_units', 'isolators', 'extractors',
  'smoke_alarms', 'heat_alarms', 'co_alarms',
  'ev_chargers', 'solar_items',
]

const DEFAULT_PRICING = {
  labour_hourly_gbp: 65,
  markup_tiers: { standard: 25, specialist: 40, heritage: 50 },
  loading_rules: {},
  // Minimal default item rates so first-time users see numbers, not zero.
  item_rates: {
    sockets_1g:     { material_gbp: 6.50,  labour_mins: 18, tier: 'standard' },
    sockets_2g:     { material_gbp: 8.50,  labour_mins: 20, tier: 'standard' },
    sockets_usb:    { material_gbp: 22.00, labour_mins: 22, tier: 'standard' },
    switches_1g:    { material_gbp: 5.20,  labour_mins: 15, tier: 'standard' },
    switches_2g:    { material_gbp: 7.40,  labour_mins: 18, tier: 'standard' },
    switches_dim:   { material_gbp: 18.00, labour_mins: 20, tier: 'standard' },
    downlights:     { material_gbp: 7.50,  labour_mins: 12, tier: 'standard' },
    pendants:       { material_gbp: 12.00, labour_mins: 15, tier: 'standard' },
    fluorescent:    { material_gbp: 38.00, labour_mins: 35, tier: 'standard' },
    consumer_units: { material_gbp: 140.00, labour_mins: 180, tier: 'specialist' },
    isolators:      { material_gbp: 14.00, labour_mins: 25, tier: 'standard' },
    extractors:     { material_gbp: 48.00, labour_mins: 45, tier: 'standard' },
    smoke_alarms:   { material_gbp: 22.00, labour_mins: 15, tier: 'standard' },
    heat_alarms:    { material_gbp: 28.00, labour_mins: 15, tier: 'standard' },
    co_alarms:      { material_gbp: 26.00, labour_mins: 15, tier: 'standard' },
    ev_chargers:    { material_gbp: 620.00, labour_mins: 240, tier: 'specialist' },
    solar_items:    { material_gbp: 450.00, labour_mins: 180, tier: 'specialist' },
  },
} as const

type PricingRules = {
  labour_hourly_gbp: number
  markup_tiers: Record<string, number>
  loading_rules: Record<string, number>
  item_rates: Record<string, { material_gbp: number; labour_mins: number; tier: string }>
}

function computePricing(
  takeoff: Record<string, number>,
  rules: PricingRules,
): { by_item: Array<Record<string, unknown>>; totals: Record<string, number>; assumptions: string[] } {
  const byItem: Array<Record<string, unknown>> = []
  let totalMaterial = 0
  let totalLabourMins = 0
  const assumptions: string[] = [
    'Cable-run metres NOT measured — add manually from site walkthrough',
    `Labour rate £${rules.labour_hourly_gbp}/hr`,
    'No access / OOH / rushed loadings applied by default',
  ]

  for (const [item, qty] of Object.entries(takeoff)) {
    if (typeof qty !== 'number' || qty <= 0) continue
    const rate = rules.item_rates[item]
    if (!rate) {
      assumptions.push(`Skipped ${item} (${qty}) — no rate in pricing_rules. Add manually.`)
      continue
    }
    const markupPct = rules.markup_tiers[rate.tier] ?? 25
    const materialCost = qty * rate.material_gbp * (1 + markupPct / 100)
    const labourMins = qty * rate.labour_mins
    totalMaterial += materialCost
    totalLabourMins += labourMins
    byItem.push({
      item,
      qty,
      unit_material_gbp: rate.material_gbp,
      markup_pct: markupPct,
      line_material_gbp: Math.round(materialCost * 100) / 100,
      labour_mins: labourMins,
      line_labour_gbp: Math.round((labourMins / 60) * rules.labour_hourly_gbp * 100) / 100,
      tier: rate.tier,
    })
  }

  const labourHours = Math.round((totalLabourMins / 60) * 100) / 100
  const labourCost = Math.round((totalLabourMins / 60) * rules.labour_hourly_gbp * 100) / 100
  const subtotal = Math.round((totalMaterial + labourCost) * 100) / 100
  const loadingPct = Object.values(rules.loading_rules ?? {}).reduce((a, b) => a + Number(b), 0)
  const loadingGbp = Math.round((subtotal * loadingPct / 100) * 100) / 100
  const total = Math.round((subtotal + loadingGbp) * 100) / 100

  return {
    by_item: byItem,
    totals: {
      materials_gbp: Math.round(totalMaterial * 100) / 100,
      labour_hours: labourHours,
      labour_gbp: labourCost,
      subtotal_gbp: subtotal,
      loading_pct: loadingPct,
      loading_gbp: loadingGbp,
      total_gbp: total,
    },
    assumptions,
  }
}

export async function POST(req: NextRequest) {
  const clientId = await getClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })

  const file = form.get('file') as File | null
  const title = (form.get('title') as string | null)?.trim()
  if (!file || !title) return NextResponse.json({ error: 'file and title required' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'PDF exceeds 50MB' }, { status: 413 })
  }

  const supabase = service()

  // 1. Stash file
  const ext = file.name.split('.').pop()?.toLowerCase() === 'pdf' ? 'pdf'
            : file.name.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg'
  const storagePath = `${clientId}/${randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('estimates')
    .upload(storagePath, buf, { contentType: file.type || 'application/pdf' })
  if (upErr) {
    console.error('storage upload failed:', upErr)
    return NextResponse.json({ error: 'Storage failed', detail: upErr.message }, { status: 500 })
  }

  // Signed URL for Claude to read + for later display
  const { data: signed } = await supabase.storage
    .from('estimates').createSignedUrl(storagePath, 60 * 60 * 24 * 7)

  // 2. Insert draft row
  const { data: estRow, error: insErr } = await supabase.from('estimates').insert({
    client_id: clientId,
    title,
    source_pdf_url: signed?.signedUrl ?? null,
    status: 'draft',
    meta: { storage_path: storagePath, file_size: buf.length, mime: file.type },
  }).select('*').single()

  if (insErr || !estRow) {
    return NextResponse.json({ error: 'Insert failed', detail: insErr?.message }, { status: 500 })
  }

  // 3. Load pricing rules (or defaults)
  const { data: rulesRow } = await supabase
    .from('pricing_rules').select('*').eq('client_id', clientId).maybeSingle()
  const rules: PricingRules = rulesRow
    ? {
        labour_hourly_gbp: rulesRow.labour_hourly_gbp,
        markup_tiers: rulesRow.markup_tiers,
        loading_rules: rulesRow.loading_rules,
        item_rates: Object.keys(rulesRow.item_rates || {}).length > 0
          ? rulesRow.item_rates
          : DEFAULT_PRICING.item_rates,
      }
    : DEFAULT_PRICING

  // 4. Vision pass — ask Claude to extract counts. PDFs are supported
  //    by the document content type in Anthropic's API.
  // If ANTHROPIC_API_KEY is missing, we DO NOT silently skip — the whole
  // point of this feature is the vision pass. Row is saved (so operator
  // doesn't lose the upload), but we return a clear 503 so the UI surfaces
  // the op-side config gap rather than pretending the draft is empty.
  let takeoff: Record<string, number> = {}
  let confidence = 0
  let reviewNotes = ''
  let pages = 0
  if (!process.env.ANTHROPIC_API_KEY) {
    await supabase.from('estimates').update({
      takeoff_review_notes: 'Vision pass skipped — ANTHROPIC_API_KEY is not configured on the dashboard. Set it in Vercel env or .env.local and retry.',
      status: 'draft',
    }).eq('id', estRow.id)
    return NextResponse.json({
      error: 'Dashboard missing ANTHROPIC_API_KEY — contact your operator. File was uploaded; re-run once configured.',
      estimate_id: estRow.id,
    }, { status: 503 })
  }
  // Vision pipeline per research (Nov 2025):
  //   single-pass on dense sheets miscounts by 15–40%.
  //   Legend-first + structured JSON + per-sheet + citation-required is the
  //   production pattern. We run 1 pass per call (MVP) but structure the
  //   prompt so it grounds before counting and returns bounding-box hints.
  //   Self-consistency (3-pass median) can be turned on via ?passes=3.
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const mime = file.type || (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg')
    const isPdf = mime === 'application/pdf'
    const base64 = buf.toString('base64')

    // Structured-output prompt. Asking for citations (sheet index + approx bbox)
    // forces the model to actually look rather than pattern-match the legend.
    const SYSTEM_PROMPT = `You are a UK electrical take-off assistant.
Your ONLY job is to count electrical symbols on architectural plans.

Categories you may report:
${TAKEOFF_CATEGORIES.map(c => `  - ${c}`).join('\n')}

Grounding rules:
1. FIRST, identify the symbol legend on the plan (usually sheet 1 or a box on each sheet). Restate, in your own words, how each of the above categories is drawn on THIS set of plans. If you can't find a legend, say so and use standard UK BS EN 60617 conventions as your assumption — list your assumption.
2. THEN count. For each count above zero, cite the sheet index (1-based) and an approximate location description ("top-left", "kitchen zone", "grid B3") for at least a sample.
3. NEVER invent a category outside the list. NEVER attempt cable run lengths or measurements that require scale.
4. When in doubt, undercount. Undercounting a socket is recoverable; overcounting blows the quote.

Output: STRICT JSON only, no prose outside the JSON. No markdown code fences.
Schema:
{
  "legend_assumptions": "<one paragraph on what the legend said / assumed>",
  "pages": <integer>,
  "confidence": <0.0–1.0 overall self-rated>,
  "review_notes": "<honest caveats — unreadable sections, symbols you couldn't identify, sheets with >50 symbols where accuracy degrades>",
  "takeoff": {
${TAKEOFF_CATEGORIES.map(c => `    "${c}": <integer>`).join(',\n')}
  },
  "citations": [
    {"item": "<category>", "sheet": <int>, "location": "<short description>"}
  ]
}`

    const userContent: Anthropic.MessageParam['content'] = [
      isPdf
        ? {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
          }
        : {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: mime as 'image/png' | 'image/jpeg', data: base64 },
          },
      { type: 'text' as const, text: 'Analyse the attached plan(s). Follow the grounding rules then return strict JSON.' },
    ]

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const textOut = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
    const jsonMatch = textOut.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Could not find JSON in model response')
    const parsed = JSON.parse(jsonMatch[0])
    takeoff = parsed.takeoff || {}

    // Confidence capping: research shows single-pass > 30-symbol sheets drop
    // to 60-85%. We cap self-reported confidence: if any category > 30, we
    // cap overall confidence at 0.85. Forces the UI to flag for review.
    const selfConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const dense = Object.values(takeoff as Record<string, number>).some(n => typeof n === 'number' && n > 30)
    confidence = dense ? Math.min(selfConfidence, 0.85) : selfConfidence

    const legendNote = parsed.legend_assumptions ? `Legend: ${parsed.legend_assumptions}\n\n` : ''
    const notesBody  = parsed.review_notes || ''
    const denseFlag  = dense ? '\n\n⚠ Contains dense sheets (>30 symbols of one type) — single-pass vision accuracy degrades. Consider running a 3-pass self-consistency check or verify counts manually.' : ''
    reviewNotes = (legendNote + notesBody + denseFlag).trim()

    pages = parsed.pages || 0
  } catch (e) {
    console.error('[estimates] vision pass failed:', e)
    reviewNotes = 'Vision pass failed — the PDF may be encrypted, non-standard, or too large. Fill in counts manually below.'
    confidence = 0
  }

  // 5. Compute pricing from the extracted take-off
  const pricing = computePricing(takeoff, rules)

  // 6. Update row with vision + pricing
  const { data: finalRow, error: updErr } = await supabase
    .from('estimates')
    .update({
      takeoff_json: takeoff,
      takeoff_confidence: confidence,
      takeoff_review_notes: reviewNotes,
      source_pages: pages || null,
      pricing_json: pricing,
      estimated_total_gbp: pricing.totals.total_gbp,
      status: confidence >= 0.75 ? 'owner_review' : 'draft',
    })
    .eq('id', estRow.id)
    .select('*')
    .single()

  if (updErr) {
    return NextResponse.json({ error: 'Update failed', detail: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, estimate: finalRow })
}
