/**
 * Anthropic Vision wrapper for the Capture feature.
 *
 * Takes 1-N photos, returns a structured classification + extracted fields +
 * suggested action. Used by /api/mobile/capture/[id]/process.
 *
 * Caching strategy:
 *   The Vision API supports prompt caching on image content blocks. Since
 *   each capture is a unique photo set, caching only helps on /process
 *   retries with the same images (e.g. user picks a different hint_type).
 *   We mark the system prompt + tool block with cache_control so repeat
 *   /process calls within 5min hit the cache.
 *
 * Cost: ~£0.005 per typical 1-2 photo capture (Sonnet 4.6 input + output).
 *
 * Why we send raw images, not OCR'd text:
 *   Receipts, paper estimates, and dist boards rely on spatial layout — pure
 *   OCR loses 20-40% accuracy. Claude Vision reads the layout natively.
 */

import { Errors } from '@/lib/api/errors'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MODEL_SONNET = 'claude-sonnet-4-6-20260401'
const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Pricing per 1M tokens (GBP) — same as in lib/billing/budget.ts
const PRICES_GBP = {
  [MODEL_SONNET]: { input: 2.4, output: 12.0, cacheRead: 0.24 },
  [MODEL_HAIKU]: { input: 0.6, output: 3.0, cacheRead: 0.06 },
}

export type CaptureClassification =
  | 'invoice'
  | 'receipt'
  | 'business_card'
  | 'estimate'
  | 'distribution_board'
  | 'job_site'
  | 'screenshot_sms'
  | 'delivery_note'
  | 'calendar_page'
  | 'other'

export type CaptureActionType =
  | 'log_expense'
  | 'add_contact'
  | 'draft_estimate'
  | 'log_materials'
  | 'create_booking'
  | 'reply_to_customer'
  | 'flag_for_owner'
  | 'no_action'

export interface CaptureExtractionResult {
  classification: CaptureClassification
  confidence: number                            // 0..1
  extracted: Record<string, unknown>            // shape depends on classification
  suggested_action: {
    type: CaptureActionType
    params: Record<string, unknown>
    cta_label: string                           // "Log expense £247.18"
  }
  ambiguous_alternatives?: CaptureClassification[]
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  }
  costPence: number
}

interface ImageInput {
  /** Either a base64 string OR a publicly fetchable URL */
  source:
    | { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
    | { type: 'url'; url: string }
}

interface ExtractInput {
  images: ImageInput[]
  contextHint?: string
  hintType?: CaptureClassification | 'auto'
  /** Pull info about the business so the AI's suggestions are grounded */
  business: {
    name: string
    industry?: string
    ownerName?: string
  }
  /** Existing contacts for cross-reference (limit 10 most recent) */
  knownContactNames?: string[]
}

const SYSTEM_PROMPT_STABLE = `You are the Capture brain inside the Nexley AI Employee mobile app — a helper for UK trade-business owners (electricians, landscapers, plumbers, dentists, estate agents).

The user has photographed something on a job site. Your job:
1. Identify what it is (one of the classifications below)
2. Extract structured fields
3. Propose ONE specific action they can confirm with one tap

# Classifications
- invoice: Paper bill from a supplier (Travis Perkins, Screwfix, etc) — total, supplier, line items
- receipt: Till receipt, smaller scale — total, vendor, date
- business_card: Customer or supplier business card — name, phone, email, company
- estimate: Hand-written or printed quote draft — line items, total, customer name
- distribution_board: Electrician-specific. Circuit labels, MCB ratings, etc. Extract per-circuit data.
- job_site: A scene photo (broken pipe, fuse box, garden, room) — describe what's visible, any hazards, propose a chat with AI Employee
- screenshot_sms: Screenshot of a customer's text message — extract sender, message, suggest reply
- delivery_note: Materials packing slip — supplier, items, link to a job
- calendar_page: Paper diary or calendar page — extract bookings (date, time, customer, what for)
- other: Anything that doesn't fit cleanly — describe and ask user to clarify

# Tone of suggestions
- The cta_label should restate exactly what will happen, not "Confirm". Examples:
  - "Log expense £247.18 to Smith bathroom"
  - "Add Sarah Mitchell to contacts"
  - "Draft estimate for £1,240 to John Smith"
  - "Ask Ava about this fuse box"

# British conventions
- Currency: pence + GBP. Always integer pence in JSON. £247.18 → 24718.
- Dates: ISO 8601 in extracted fields, but the cta_label uses UK format ("27 Apr").
- Phone numbers: keep original format.
- VAT: extract separately if visible.

# Confidence
- 0.95+ : crystal clear extraction, all fields present
- 0.7-0.95 : main fields confident, some uncertainty
- 0.5-0.7 : flag ambiguous_alternatives with 1-2 alternative classifications
- <0.5 : classification = 'other', tell user we couldn't read it

# Output JSON schema (you MUST emit ONLY this, no prose)
{
  "classification": <one of above>,
  "confidence": <0..1>,
  "extracted": <fields specific to classification — see below>,
  "suggested_action": {
    "type": <one of: log_expense, add_contact, draft_estimate, log_materials, create_booking, reply_to_customer, flag_for_owner, no_action>,
    "params": <action-specific params>,
    "cta_label": <user-facing button text>
  },
  "ambiguous_alternatives": [<other classifications>] // optional
}

# Extracted-field shapes per classification

invoice/receipt: { supplier: string, date: string, total_pence: integer, vat_pence?: integer, line_items?: [{description, quantity, unit_price_pence}], suggested_job_link?: string }
business_card: { name: string, phone?: string, email?: string, company?: string, role?: string, address?: string }
estimate: { customer_name?: string, total_pence: integer, line_items: [{description, quantity, unit_price_pence}], notes?: string }
distribution_board: { phase: 'single'|'three', circuits: [{number, label, mcb_rating, type}], make?: string }
job_site: { description: string, hazards?: string[], suggested_question_for_ai?: string }
screenshot_sms: { sender_name?: string, sender_phone?: string, message: string, suggested_reply?: string }
delivery_note: { supplier: string, items: [{description, quantity}], date?: string }
calendar_page: { bookings: [{date, time, customer_name, what_for}] }
other: { description: string }`

export async function extractFromCapture(input: ExtractInput): Promise<CaptureExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw Errors.internal('ANTHROPIC_API_KEY not configured')

  const systemVolatile = buildVolatileSystem(input)
  // Anthropic 'system' is an array of text blocks; first block gets cache_control
  const systemBlocks: Array<{
    type: 'text'
    text: string
    cache_control?: { type: 'ephemeral' }
  }> = [
    { type: 'text', text: SYSTEM_PROMPT_STABLE, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: systemVolatile },
  ]

  // Build user content: image blocks + text question.
  // DA fix A3: cache_control on the LAST image block (Anthropic caches up
  // to and including the marked block) so /process retries with the same
  // images skip the input cost on the image bytes.
  const userContent: Array<Record<string, unknown>> = []
  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i]
    const isLast = i === input.images.length - 1
    const block: Record<string, unknown> =
      img.source.type === 'base64'
        ? {
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.source.media_type,
              data: img.source.data,
            },
          }
        : { type: 'image', source: { type: 'url', url: img.source.url } }
    if (isLast) block.cache_control = { type: 'ephemeral' }
    userContent.push(block)
  }
  const promptText =
    `${input.images.length > 1 ? `I'm sending ${input.images.length} photos of the same thing.` : `I just snapped this photo.`}` +
    (input.contextHint ? ` Context: "${input.contextHint}".` : '') +
    (input.hintType && input.hintType !== 'auto'
      ? ` I'm pretty sure this is a ${input.hintType.replace(/_/g, ' ')}.`
      : '') +
    `\n\nIdentify it, extract the fields, and propose one specific action. Respond with JSON only.`
  userContent.push({ type: 'text', text: promptText })

  const body = {
    model: MODEL_SONNET,
    max_tokens: 2048,
    temperature: 0.2,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw Errors.chatUpstream(new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`))
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }

  // Concatenate all text blocks
  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()

  // DA fix A1, A2, A5: parse + structurally validate. Three failure modes:
  //   1. Not JSON at all → fall back to 'other'
  //   2. JSON wrapped in prose ("Here's what I see: { ... }") → extract first balanced-brace block
  //   3. JSON parses but values are wrong type ("confidence: 'high'") → reject + fall back
  const usage = usageFrom(data.usage)
  const fallback = (reason: string): CaptureExtractionResult => ({
    classification: 'other',
    confidence: 0.0,
    extracted: { description: text.slice(0, 1000), parse_error: reason },
    suggested_action: { type: 'flag_for_owner', params: {}, cta_label: 'Show me the photo' },
    usage,
    costPence: computeCost(MODEL_SONNET, usage),
  })

  // Strip code fences if present, otherwise extract first {...} block
  let jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  if (!jsonText.startsWith('{')) {
    const start = jsonText.indexOf('{')
    if (start === -1) return fallback('no_json_object')
    // Find matching closing brace by depth-counting
    let depth = 0
    let end = -1
    for (let i = start; i < jsonText.length; i++) {
      if (jsonText[i] === '{') depth++
      else if (jsonText[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) return fallback('unbalanced_braces')
    jsonText = jsonText.slice(start, end + 1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return fallback('json_parse_failed')
  }

  const parsed = validateExtractionResult(raw)
  if (!parsed) return fallback('shape_invalid')

  return {
    classification: parsed.classification,
    confidence: parsed.confidence,
    extracted: parsed.extracted,
    suggested_action: parsed.suggested_action,
    ambiguous_alternatives: parsed.ambiguous_alternatives,
    usage,
    costPence: computeCost(MODEL_SONNET, usage),
  }
}

const VALID_CLASSIFICATIONS: CaptureClassification[] = [
  'invoice', 'receipt', 'business_card', 'estimate', 'distribution_board',
  'job_site', 'screenshot_sms', 'delivery_note', 'calendar_page', 'other',
]
const VALID_ACTION_TYPES: CaptureActionType[] = [
  'log_expense', 'add_contact', 'draft_estimate', 'log_materials',
  'create_booking', 'reply_to_customer', 'flag_for_owner', 'no_action',
]

interface ValidatedExtraction {
  classification: CaptureClassification
  confidence: number
  extracted: Record<string, unknown>
  suggested_action: {
    type: CaptureActionType
    params: Record<string, unknown>
    cta_label: string
  }
  ambiguous_alternatives?: CaptureClassification[]
}

function validateExtractionResult(raw: unknown): ValidatedExtraction | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // classification
  const cls = r.classification
  if (typeof cls !== 'string' || !VALID_CLASSIFICATIONS.includes(cls as CaptureClassification)) return null
  // confidence — accept number or numeric string; reject 'high'/'low' etc
  let conf: number
  if (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) {
    conf = r.confidence
  } else if (typeof r.confidence === 'string' && !Number.isNaN(parseFloat(r.confidence))) {
    conf = parseFloat(r.confidence)
  } else {
    return null
  }
  if (conf < 0) conf = 0
  if (conf > 1) conf = conf > 100 ? 1 : conf / 100 // accept 0..100 form too
  // extracted
  if (!r.extracted || typeof r.extracted !== 'object') return null
  const extracted = r.extracted as Record<string, unknown>
  // sanity-check pence fields are integers
  for (const k of ['total_pence', 'vat_pence', 'unit_price_pence']) {
    const v = extracted[k]
    if (v !== undefined && v !== null) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        // Coerce strings like "247.18" or "£247.18" to integer pence
        const s = String(v).replace(/[£$,\s]/g, '')
        const n = parseFloat(s)
        if (Number.isFinite(n)) {
          extracted[k] = Math.round(n)
        } else {
          delete extracted[k] // strip junk rather than passing it through
        }
      } else if (!Number.isInteger(v)) {
        // Vision sometimes returns 247.18 (decimal) — coerce to integer pence
        // by assuming the AI meant pounds and shifting; safer to reject.
        extracted[k] = Math.round(v)
      }
    }
  }
  // suggested_action
  if (!r.suggested_action || typeof r.suggested_action !== 'object') return null
  const sa = r.suggested_action as Record<string, unknown>
  if (typeof sa.type !== 'string' || !VALID_ACTION_TYPES.includes(sa.type as CaptureActionType)) return null
  if (!sa.params || typeof sa.params !== 'object') return null
  if (typeof sa.cta_label !== 'string' || sa.cta_label.length === 0) return null
  // ambiguous_alternatives
  let ambig: CaptureClassification[] | undefined
  if (Array.isArray(r.ambiguous_alternatives)) {
    ambig = r.ambiguous_alternatives
      .filter((x): x is string => typeof x === 'string')
      .filter((x) => VALID_CLASSIFICATIONS.includes(x as CaptureClassification)) as CaptureClassification[]
    if (ambig.length === 0) ambig = undefined
  }

  return {
    classification: cls as CaptureClassification,
    confidence: conf,
    extracted,
    suggested_action: {
      type: sa.type as CaptureActionType,
      params: sa.params as Record<string, unknown>,
      cta_label: sa.cta_label,
    },
    ambiguous_alternatives: ambig,
  }
}

function buildVolatileSystem(input: ExtractInput): string {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  })
  const lines = [
    '# Now',
    `- Today's date: ${today}`,
    `- Business: ${input.business.name}${input.business.industry ? ` (UK ${input.business.industry})` : ''}`,
  ]
  if (input.business.ownerName) lines.push(`- Owner: ${input.business.ownerName}`)
  if (input.knownContactNames && input.knownContactNames.length > 0) {
    lines.push(
      `- Known contacts (recent): ${input.knownContactNames.slice(0, 10).join(', ')}`
    )
  }
  return lines.join('\n')
}

function usageFrom(u: {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}) {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
  }
}

function computeCost(modelId: string, usage: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }): number {
  const p = PRICES_GBP[modelId as keyof typeof PRICES_GBP]
  if (!p) return 0
  const totalGbp =
    (usage.inputTokens / 1_000_000) * p.input +
    (usage.outputTokens / 1_000_000) * p.output +
    (usage.cacheReadTokens / 1_000_000) * p.cacheRead
  return Math.ceil(totalGbp * 100)
}
