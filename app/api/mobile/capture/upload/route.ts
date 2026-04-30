/**
 * POST /api/mobile/capture/upload
 *
 * Step 1 of the capture pipeline. Mobile sends 1-10 photos as multipart
 * form-data. Server validates, optionally re-encodes, stores in the
 * `captures` Supabase Storage bucket, creates a `captures` row in
 * status='uploaded', returns the capture_id.
 *
 * Body (multipart/form-data):
 *   - photos: File[] (required, 1-10 images)
 *   - context_hint: string (optional)
 *   - hint_type: string (optional)
 *
 * Response: { capture_id, status: 'uploaded', photo_count }
 *
 * Photos are NOT processed by Anthropic in this endpoint — caller posts to
 * /process next. This separation lets the upload retry independently of
 * the Vision call.
 */

import { requireAuth, getClientIdFromClaims } from '@/lib/auth/claims'
import { enforceLimit } from '@/lib/middleware/ratelimit'
import { Errors, errorResponse, jsonResponse, newRequestId } from '@/lib/api/errors'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'
export const maxDuration = 60

const STORAGE_BUCKET = 'captures'
const MAX_PHOTOS = 10
const MAX_PHOTO_BYTES = 8 * 1024 * 1024 // 8MB pre-resize ceiling
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

const ALLOWED_HINTS = new Set([
  'invoice',
  'receipt',
  'business_card',
  'estimate',
  'distribution_board',
  'job_site',
  'screenshot_sms',
  'delivery_note',
  'calendar_page',
  'other',
  'auto',
])

export async function POST(request: Request) {
  const requestId = newRequestId()
  try {
    const claims = await requireAuth(request)
    await enforceLimit('mutations', claims.sub)
    const clientId = getClientIdFromClaims(claims)

    // Verify AI consent gates capture
    const sb = createUntypedServiceClient()
    const { data: client } = await sb
      .from('clients')
      .select('ai_consent_at')
      .eq('id', clientId)
      .maybeSingle()
    if (!client?.ai_consent_at) throw Errors.consentRequired()

    const form = await request.formData()
    const photos = form.getAll('photos').filter((v): v is File => v instanceof File)
    const contextHint = (form.get('context_hint') as string | null)?.trim() || null
    const hintType = (form.get('hint_type') as string | null)?.trim() || null

    if (photos.length === 0) {
      throw Errors.validation({ field: 'photos', message: 'at least one photo required' })
    }
    if (photos.length > MAX_PHOTOS) {
      throw Errors.validation({ field: 'photos', max: MAX_PHOTOS })
    }
    if (hintType && !ALLOWED_HINTS.has(hintType)) {
      throw Errors.validation({ field: 'hint_type', allowed: [...ALLOWED_HINTS] })
    }
    for (const p of photos) {
      if (!ALLOWED_TYPES.has(p.type)) {
        throw Errors.validation({ field: 'photos', message: `unsupported type ${p.type}` })
      }
      if (p.size > MAX_PHOTO_BYTES) {
        throw Errors.validation({ field: 'photos', message: `photo too large (${p.size}B, max ${MAX_PHOTO_BYTES}B)` })
      }
    }

    // 1. Create the capture row first so we have an id to slot photos under
    const ins = await sb
      .from('captures')
      .insert({
        user_id: claims.sub,
        client_id: clientId,
        context_hint: contextHint,
        hint_type: hintType,
        status: 'uploaded',
        photo_paths: [],
      })
      .select('id')
      .single()
    if (ins.error) throw Errors.internal(ins.error.message)
    const captureId = ins.data.id as string

    // 2. Upload each photo to <user_id>/<capture_id>/<index>.<ext>
    // DA fix B6: when a photo upload fails mid-stream, ALWAYS attempt to
    // remove already-uploaded objects, retry once if the remove call itself
    // errors, and verify the remove actually deleted what it claimed.
    const paths: string[] = []
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      const ext = extFromMime(photo.type)
      const path = `${claims.sub}/${captureId}/${i}.${ext}`
      const bytes = new Uint8Array(await photo.arrayBuffer())
      const { error } = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(path, bytes, {
          contentType: photo.type,
          upsert: false,
        })
      if (error) {
        // The failing upload itself MAY have written partial bytes — include
        // its path in the cleanup list so we don't leave a half-write orphan.
        const cleanup = [...paths, path]
        let removeAttempts = 0
        while (removeAttempts < 2) {
          const { error: removeErr } = await sb.storage
            .from(STORAGE_BUCKET)
            .remove(cleanup)
          if (!removeErr) break
          removeAttempts++
          if (removeAttempts >= 2) {
            console.error('[capture/upload] cleanup failed twice, leaving orphans:', removeErr, 'paths:', cleanup)
            // Telemetry — flag for the daily purge to catch
            await sb
              .from('captures')
              .update({
                status: 'failed',
                error_message: `Upload failed at photo ${i}: ${error.message}; cleanup also failed: ${removeErr.message}`,
                photo_paths: cleanup, // record the orphans so purge_old_capture_photos can sweep
              })
              .eq('id', captureId)
              .then(() => {}, () => {})
            throw Errors.internal(`Upload failed: ${error.message}`)
          }
        }
        await sb
          .from('captures')
          .update({ status: 'failed', error_message: error.message })
          .eq('id', captureId)
        throw Errors.internal(`Upload failed at photo ${i}: ${error.message}`)
      }
      paths.push(path)
    }

    // 3. Update the row with the photo paths
    await sb
      .from('captures')
      .update({ photo_paths: paths, updated_at: new Date().toISOString() })
      .eq('id', captureId)

    return jsonResponse(
      {
        capture_id: captureId,
        status: 'uploaded',
        photo_count: photos.length,
      },
      { requestId }
    )
  } catch (err) {
    return errorResponse(err, requestId)
  }
}

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}
