/**
 * GET /api/vault/files/[id]/url → { url, expires_at, filename, mime_type }
 *
 * Mints a short-lived signed download URL for a vault file. Works for both
 * the browser (user JWT) and the agent (via the /api/agent/vault/file
 * route, which wraps this internally).
 *
 * RLS on vault_files covers the read — if the user can see the row, they
 * can download. If they can't, they get a 404 (not a 403, so the presence
 * or absence of a file is never confirmable cross-tenant).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DOWNLOAD_URL_EXPIRES_SEC, vaultService, VAULT_BUCKET } from '@/lib/vault/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Use the USER client for the lookup so RLS applies — this is the
  // primary authorization gate. If RLS blocks, we get null and return 404.
  const { data: row } = await supabase
    .from('vault_files')
    .select('id, filename, mime_type, storage_path, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (!row || row.deleted_at) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const svc = vaultService()
  const { data: signed, error } = await svc.storage
    .from(VAULT_BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_URL_EXPIRES_SEC)
  if (error || !signed) {
    return NextResponse.json({ error: error?.message || 'could not sign url' }, { status: 500 })
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_at: new Date(Date.now() + DOWNLOAD_URL_EXPIRES_SEC * 1000).toISOString(),
    filename: row.filename,
    mime_type: row.mime_type,
  })
}
