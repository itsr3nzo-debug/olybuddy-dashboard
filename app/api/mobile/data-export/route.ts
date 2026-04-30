/**
 * POST /api/mobile/data-export
 *
 * GDPR Article 15 — Right of access. The user requests an export of their
 * personal data; we have 30 days to deliver but typically same-day.
 *
 * This endpoint:
 *   1. Calls requireFreshAuth() — sensitive op, re-checks session is still
 *      server-side valid (closes the JWKS revocation window completely)
 *   2. Inserts a `gdpr_requests` row with status='received'
 *   3. Returns the request id so the user can poll for the download URL
 *
 * The actual export is run by an async cron worker (api/cron/process-gdpr-requests)
 * which compiles the JSON dump, uploads to Supabase Storage with a signed
 * 7-day URL, and sets `download_url`/`download_expires_at`.
 *
 * Idempotent: if the user has an in-flight request from the last 24h, returns
 * the existing one rather than creating a duplicate.
 */

import { requireFreshAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'


export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireFreshAuth(request)
    await enforceLimit('mutations', claims.sub)

    const clientId = getClientIdFromClaims(claims)
    const sb = createUntypedServiceClient()

    // Check for in-flight request in the last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await sb
      .from('gdpr_requests')
      .select('id, status, download_url, download_expires_at, created_at')
      .eq('user_id', claims.sub)
      .eq('request_type', 'export')
      .in('status', ['received', 'processing', 'completed'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      return jsonResponse(
        {
          request_id: existing.id,
          status: existing.status,
          download_url: existing.download_url,
          download_expires_at: existing.download_expires_at,
          message: 'A recent export already exists.',
        },
        { requestId }
      )
    }

    const { data: created, error } = await sb
      .from('gdpr_requests')
      .insert({
        user_id: claims.sub,
        client_id: clientId,
        email: claims.email ?? '',
        request_type: 'export',
        status: 'received',
      })
      .select('id, created_at')
      .single()
    if (error) throw Errors.internal(error.message)

    return jsonResponse(
      {
        request_id: created.id,
        status: 'received',
        message:
          'We have received your export request and will email a download link within 72 hours.',
      },
      { status: 202, requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

/**
 * GET /api/mobile/data-export?id=<uuid>
 * Poll for status — returns download_url when ready.
 */
export async function GET(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireFreshAuth(request)
    await enforceLimit('reads', claims.sub)

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) throw Errors.validation({ field: 'id' })

    const sb = createUntypedServiceClient()
    const { data, error } = await sb
      .from('gdpr_requests')
      .select('id, status, download_url, download_expires_at, rejection_reason, created_at, completed_at')
      .eq('id', id)
      .eq('user_id', claims.sub)
      .maybeSingle()
    if (error) throw Errors.internal(error.message)
    if (!data) throw Errors.notFound()
    return jsonResponse(data, { requestId })
  } catch (err) {
    return errorResponse(err, requestId)
  }
}
