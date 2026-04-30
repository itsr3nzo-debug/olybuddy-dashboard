/**
 * POST /api/mobile/capture/[id]/process
 *
 * Step 2 of the capture pipeline. Pulls photos from Storage, sends to
 * Anthropic Vision, persists classification + extracted + suggested_action
 * onto the captures row, returns the result for the mobile confirm card.
 *
 * Idempotent within a hint_type — re-calling with the same hint returns
 * the cached extraction (still in DB). Pass `?retry_with_hint=invoice`
 * to force re-extraction with a different classification hint.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'
import { extractFromCapture, type CaptureClassification } from '@/lib/llm/vision'
import { recordLlmSpend, reserveBudgetTier } from '@/lib/billing/budget'

export const runtime = 'nodejs'
export const maxDuration = 60

const STORAGE_BUCKET = 'captures'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('chat_send', claims.sub)
    const clientId = getClientIdFromClaims(claims)
    const { id: captureId } = await params

    const url = new URL(request.url)
    const retryHint = url.searchParams.get('retry_with_hint') as CaptureClassification | null

    const sb = createUntypedServiceClient()

    // 1. Load the capture (must belong to caller)
    const { data: cap, error: capErr } = await sb
      .from('captures')
      .select('id, user_id, client_id, photo_paths, context_hint, hint_type, status, classification')
      .eq('id', captureId)
      .eq('user_id', claims.sub)
      .maybeSingle()
    if (capErr) throw Errors.internal(capErr.message)
    if (!cap) throw Errors.notFound('Capture not found.')
    if (cap.status === 'committed') {
      throw Errors.validation({ message: 'Already committed' })
    }
    if (!cap.photo_paths || cap.photo_paths.length === 0) {
      throw Errors.validation({ message: 'No photos attached to this capture' })
    }

    // 2. If already extracted and no retry-hint, return cached
    if (cap.status === 'extracted' && !retryHint) {
      const { data: full } = await sb
        .from('captures')
        .select('classification, confidence, extracted, suggested_action, ambiguous_alternatives')
        .eq('id', captureId)
        .maybeSingle()
      return jsonResponse(
        {
          capture_id: captureId,
          ...(full ?? {}),
          cached: true,
        },
        { requestId }
      )
    }

    // 3. DA fix B7: Atomic claim — UPDATE WHERE status NOT processing.
    // If rowCount=0, another concurrent request beat us; return 409 instead
    // of double-billing Anthropic.
    const claim = await sb
      .from('captures')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', captureId)
      .neq('status', 'processing')
      .select('id')
    if (claim.error) throw Errors.internal(claim.error.message)
    if (!claim.data || claim.data.length === 0) {
      // Another /process call has the lock. Return what's currently in the
      // DB rather than spinning up a second Vision call.
      const { data: current } = await sb
        .from('captures')
        .select('status, classification, confidence, extracted, suggested_action, ambiguous_alternatives')
        .eq('id', captureId)
        .maybeSingle()
      return jsonResponse(
        {
          capture_id: captureId,
          ...(current ?? {}),
          concurrent: true,
        },
        { status: 202, requestId }
      )
    }

    // 4. Get business context
    const [clientRow, agentConfig, recentContacts] = await Promise.all([
      sb.from('clients').select('name, industry, subscription_plan').eq('id', clientId).maybeSingle(),
      sb.from('agent_config').select('owner_name, business_name').eq('client_id', clientId).maybeSingle(),
      sb
        .from('contacts')
        .select('first_name, last_name')
        .eq('client_id', clientId)
        .order('last_contacted', { ascending: false, nullsFirst: false })
        .limit(10),
    ])

    // 5. Pre-flight budget check
    const plan = (clientRow.data?.subscription_plan as string | null) ?? null
    const tier = await reserveBudgetTier(clientId, plan)
    if (tier === 'hard_capped') {
      await sb.from('captures').update({ status: 'failed', error_message: 'Budget cap reached' }).eq('id', captureId)
      throw Errors.budgetHardCapped()
    }

    // 6. Generate signed URLs for the photos (Anthropic accepts publicly fetchable URLs)
    const signed = await Promise.all(
      (cap.photo_paths as string[]).map(async (p) => {
        const { data, error } = await sb.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(p, 600) // 10 min — Anthropic fetches it within seconds
        if (error || !data) throw new Error(`Sign URL failed for ${p}: ${error?.message}`)
        return data.signedUrl
      })
    )

    // 7. Call Vision
    const knownNames = ((recentContacts.data ?? []) as Array<{ first_name?: string; last_name?: string }>)
      .map((c) => [c.first_name, c.last_name].filter(Boolean).join(' '))
      .filter((n) => n.length > 0)

    const result = await extractFromCapture({
      images: signed.map((url) => ({ source: { type: 'url', url } })),
      contextHint: cap.context_hint ?? undefined,
      hintType: retryHint ?? (cap.hint_type as CaptureClassification | null) ?? 'auto',
      business: {
        name: agentConfig.data?.business_name ?? clientRow.data?.name ?? 'this business',
        industry: clientRow.data?.industry ?? undefined,
        ownerName: agentConfig.data?.owner_name ?? undefined,
      },
      knownContactNames: knownNames,
    })

    // 8. Persist + spend
    await sb
      .from('captures')
      .update({
        status: 'extracted',
        classification: result.classification,
        confidence: result.confidence,
        extracted: result.extracted,
        suggested_action: result.suggested_action,
        ambiguous_alternatives: result.ambiguous_alternatives ?? null,
        vision_input_tokens: result.usage.inputTokens,
        vision_output_tokens: result.usage.outputTokens,
        vision_cost_pence: result.costPence,
        hint_type: retryHint ?? cap.hint_type, // remember the latest hint
        updated_at: new Date().toISOString(),
      })
      .eq('id', captureId)

    await recordLlmSpend(clientId, result.costPence, plan).catch((err) =>
      console.error('[capture/process] recordLlmSpend failed:', err)
    )

    return jsonResponse(
      {
        capture_id: captureId,
        classification: result.classification,
        confidence: result.confidence,
        extracted: result.extracted,
        suggested_action: result.suggested_action,
        ambiguous_alternatives: result.ambiguous_alternatives,
        cost_pence: result.costPence,
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
