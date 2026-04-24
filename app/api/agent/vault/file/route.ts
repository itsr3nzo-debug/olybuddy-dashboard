/**
 * GET /api/agent/vault/file?id=<uuid>
 *
 * Returns the extracted text + a signed download URL for the original
 * file, scoped to the calling agent's client.
 *
 * The agent's local `vault-fetch.sh` caches responses keyed by sha256 so
 * repeat fetches within a conversation are free; this endpoint is only
 * hit on cache miss or when the cached sha256 doesn't match.
 *
 * Deleted files return 410 Gone so the cache knows to evict.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { DOWNLOAD_URL_EXPIRES_SEC, vaultService, VAULT_BUCKET } from '@/lib/vault/server'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const id = new URL(req.url).searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const svc = vaultService()
  const { data: row, error } = await svc
    .from('vault_files')
    .select('id, client_id, project_id, filename, mime_type, size_bytes, sha256, page_count, status, extracted_text, storage_path, deleted_at, vault_projects(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!row || row.client_id !== auth.clientId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (row.deleted_at) {
    return NextResponse.json({ error: 'gone', detail: 'file was deleted' }, { status: 410 })
  }
  if (row.status !== 'ready' && row.status !== 'failed') {
    return NextResponse.json({
      status: row.status,
      detail: 'file still processing — retry in a few seconds',
    }, { status: 202 })
  }

  const { data: signed, error: signErr } = await svc.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_URL_EXPIRES_SEC)
  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message || 'sign failed' }, { status: 500 })
  }

  // Supabase types this join as `{name}[]` even though it's a to-one relation
  // (FK is one-to-many from the parent side). Narrow through unknown to the
  // actual shape — we only ever get one row back.
  const projJoin = row.vault_projects as unknown as { name: string } | { name: string }[] | null
  const proj = Array.isArray(projJoin) ? (projJoin[0] ?? null) : projJoin
  return NextResponse.json({
    file_id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    page_count: row.page_count,
    project_id: row.project_id,
    project_name: proj?.name ?? null,
    status: row.status,
    extracted_text: row.extracted_text ?? '',
    signed_url: signed.signedUrl,
    signed_url_expires_in: DOWNLOAD_URL_EXPIRES_SEC,
  })
}

// Keep a 404 safety-net if someone POSTs with our payload shape.
export function POST() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 })
}

// Placeholder so this file references safeErrorDetail — used if we add
// future paths where a Fergus-style 502 makes sense.
void safeErrorDetail
