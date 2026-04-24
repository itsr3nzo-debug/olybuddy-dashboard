/**
 * PATCH  /api/vault/projects/[id] — rename / edit description / archive
 * DELETE /api/vault/projects/[id] — permanent delete (cascades to files)
 *
 * RLS enforces client_id scoping; super_admin bypasses via service-role.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveClientId, isSuperAdmin } from '@/lib/chat/resolve-client'

function writerFor(isAdmin: boolean, userClient: Awaited<ReturnType<typeof createClient>>) {
  return isAdmin
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
    : userClient
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const patch: { name?: string; description?: string | null; archived_at?: string | null } = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 120)
  if (typeof body?.description === 'string') patch.description = body.description.slice(0, 500)
  if (body?.archived === true) patch.archived_at = new Date().toISOString()
  if (body?.archived === false) patch.archived_at = null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const admin = isSuperAdmin(user)
  const writer = writerFor(admin, supabase)

  // Resolve the caller's intended client_id so we can tighten the WHERE clause.
  // Non-admins: pinned to their own client via RLS. Admins: service-role
  // bypasses RLS, so include an explicit client_id match sourced from the
  // project's own row to prevent a stray id from mutating a different tenant.
  let clientIdFilter: string | null = null
  if (admin) {
    const svc = writerFor(true, supabase)
    const { data: proj } = await svc
      .from('vault_projects')
      .select('client_id')
      .eq('id', id)
      .maybeSingle()
    if (!proj) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    clientIdFilter = proj.client_id
  }

  let q = writer.from('vault_projects').update(patch).eq('id', id)
  if (clientIdFilter) q = q.eq('client_id', clientIdFilter)
  const { data, error } = await q
    .select('id, name, description, created_at, archived_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ project: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { clientId, isAdminOverride } = resolveClientId(user, new URL(req.url).searchParams.get('client') || undefined)
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 })

  const writer = writerFor(isAdminOverride, supabase)
  // Look up storage paths so we can purge the actual files alongside the
  // metadata rows — FK cascade handles the DB, but the bucket doesn't know
  // about cascades.
  const { data: filesToPurge } = await writer
    .from('vault_files')
    .select('storage_path')
    .eq('project_id', id)
    .eq('client_id', clientId)
  const paths = (filesToPurge ?? []).map(f => f.storage_path).filter(Boolean)
  if (paths.length > 0) {
    await writer.storage.from('vault').remove(paths)
  }

  const { error } = await writer
    .from('vault_projects')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, files_purged: paths.length })
}
