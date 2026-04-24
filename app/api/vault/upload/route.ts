/**
 * POST /api/vault/upload
 *   body: { project_id, filename, mime_type, size_bytes, client_id? }
 *   → { file_id, upload_url, token, path, expires_in }
 *
 * Reserves a row in vault_files (status='uploaded' initial) and returns a
 * signed upload URL that the client PUTs to directly. Callers then hit
 * /api/vault/upload/complete once the PUT succeeds so we can flip status to
 * 'processing' and enqueue text extraction.
 *
 * Why two-step: direct-to-storage uploads skip Vercel's 4.5MB body limit
 * and keep bandwidth off the serverless tier. Matches how Harvey, Notion,
 * Linear all handle file uploads.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/chat/resolve-client'
import { isAllowedMime, MAX_FILE_BYTES, storagePathFor, UPLOAD_URL_EXPIRES_SEC, vaultService, VAULT_BUCKET } from '@/lib/vault/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const projectId: string | undefined = body?.project_id
  const filename: string | undefined = body?.filename
  const mimeType: string | undefined = body?.mime_type
  const sizeBytes: number | undefined = body?.size_bytes
  const explicit: string | undefined = body?.client_id

  if (!projectId || !filename || !mimeType || typeof sizeBytes !== 'number') {
    return NextResponse.json({ error: 'missing project_id / filename / mime_type / size_bytes' }, { status: 400 })
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `file too big — max ${MAX_FILE_BYTES} bytes` }, { status: 413 })
  }
  if (!isAllowedMime(mimeType)) {
    return NextResponse.json({ error: `unsupported mime type: ${mimeType}` }, { status: 415 })
  }

  const { clientId, spoofRejected } = resolveClientId(user, explicit)
  if (spoofRejected) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 })

  // Verify the project belongs to this client. Service-role lookup keeps the
  // check independent of the caller's JWT scope (super_admin + tenant both
  // funnel through the same verification).
  const svc = vaultService()
  const { data: project } = await svc
    .from('vault_projects')
    .select('id')
    .eq('id', projectId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!project) {
    return NextResponse.json({ error: 'project not found or not in your client' }, { status: 404 })
  }

  // Pre-generate the file UUID so we can both (a) write the DB row now and
  // (b) embed it in the storage path. Paths never change, so signed URLs
  // issued later (citations, agent fetch) always land on the same object.
  const { data: fileRow, error: insertErr } = await svc
    .from('vault_files')
    .insert({
      project_id: projectId,
      client_id: clientId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      status: 'uploaded',
      uploaded_by: user.id,
      storage_path: `${clientId}/${projectId}/pending-${Date.now()}`, // placeholder — overwritten immediately below
    })
    .select('id')
    .single()
  if (insertErr || !fileRow) {
    return NextResponse.json({ error: insertErr?.message || 'failed to reserve row' }, { status: 500 })
  }

  const path = storagePathFor({ clientId, projectId, fileId: fileRow.id, filename })
  // Update the row with the canonical path; keeps storage_path unique constraint happy.
  await svc.from('vault_files').update({ storage_path: path }).eq('id', fileRow.id)

  // Mint a resumable upload URL. Supabase returns `{ signedUrl, token, path }`.
  const { data: signed, error: signErr } = await svc.storage
    .from(VAULT_BUCKET)
    .createSignedUploadUrl(path)
  if (signErr || !signed) {
    // Roll back the row — otherwise we leak zombie rows on transient failures.
    await svc.from('vault_files').delete().eq('id', fileRow.id)
    return NextResponse.json({ error: signErr?.message || 'could not mint upload url' }, { status: 500 })
  }

  return NextResponse.json({
    file_id: fileRow.id,
    upload_url: signed.signedUrl,
    token: signed.token,
    path,
    expires_in: UPLOAD_URL_EXPIRES_SEC,
  })
}
