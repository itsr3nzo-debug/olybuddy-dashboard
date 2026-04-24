/**
 * DELETE /api/vault/files/[id] — permanent delete (metadata row + object).
 *
 * Soft-delete is not exposed to users; the product decision is that Vault
 * Delete Means Delete (legal-adjacent for trades clients handling customer
 * records). The `deleted_at` column exists for in-flight recovery if the
 * Storage purge fails; we still try to bury the row and surface an error
 * if purge fails so the user knows to retry.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { vaultService, VAULT_BUCKET } from '@/lib/vault/server'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Lookup via user client — RLS blocks cross-tenant writes even if the
  // caller crafts an ID they don't own.
  const { data: row } = await supabase
    .from('vault_files')
    .select('id, storage_path, client_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const svc = vaultService()
  // Mark deleted first so a concurrent agent fetch gets a 410 immediately.
  await svc.from('vault_files').update({ deleted_at: new Date().toISOString() }).eq('id', row.id)

  // Purge the object. If the purge fails, leave the row soft-deleted so a
  // background sweep can retry without losing track of it.
  const { error: rmErr } = await svc.storage.from(VAULT_BUCKET).remove([row.storage_path])
  if (rmErr) {
    return NextResponse.json(
      { error: `object purge failed: ${rmErr.message}. Row marked deleted, will retry.` },
      { status: 502 },
    )
  }

  // Hard-delete the row once the object is gone.
  const { error: delErr } = await svc.from('vault_files').delete().eq('id', row.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
