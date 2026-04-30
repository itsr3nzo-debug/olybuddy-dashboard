/**
 * POST /api/mobile/onboarding/ai-consent
 *
 * Apple App Review Guideline 5.1.2(i) requires explicit, named consent
 * before any AI feature runs. This endpoint records that consent.
 *
 * Body: { consented: true, consent_version: '1.0' }
 * Response: 204 on success
 *
 * If consent is not on file, all chat endpoints will return 403
 * `auth.consent_required` until this is called.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


const CURRENT_CONSENT_VERSION = '1.0'

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)

    const body = (await request.json().catch(() => null)) as
      | { consented?: boolean; consent_version?: string }
      | null
    if (!body || body.consented !== true) {
      throw Errors.validation({ field: 'consented', expected: true })
    }
    const version = body.consent_version ?? CURRENT_CONSENT_VERSION

    const clientId = getClientIdFromClaims(claims)
    const sb = createUntypedServiceClient()

    const { error } = await sb
      .from('clients')
      .update({
        ai_consent_at: new Date().toISOString(),
        ai_consent_version: version,
      })
      .eq('id', clientId)

    if (error) throw Errors.internal(error.message)

    return jsonResponse({ ok: true, consent_version: version }, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
