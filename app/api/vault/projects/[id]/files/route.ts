/**
 * GET /api/vault/projects/[id]/files → paginated file list for a project.
 *
 * Query params:
 *   status=ready|processing|failed|uploaded (filter)
 *   q=<text> (filename substring filter — pre-FTS; the real FTS is on the
 *     agent-facing /api/agent/vault/search)
 *   limit, offset
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveClientId } from '@/lib/chat/resolve-client'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const { clientId, isAdminOverride } = resolveClientId(user, url.searchParams.get('client') || undefined)
  if (!clientId) return NextResponse.json({ files: [], count: 0 })

  const reader = isAdminOverride
    ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
    : supabase

  const status = url.searchParams.get('status')
  const q = (url.searchParams.get('q') || '').trim()
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

  let query = reader
    .from('vault_files')
    .select('id, project_id, filename, mime_type, size_bytes, tags, page_count, status, error_message, uploaded_at, processed_at', { count: 'exact' })
    .eq('project_id', projectId)
    .eq('client_id', clientId)
    .is('deleted_at', null)

  if (status) query = query.eq('status', status)
  if (q) query = query.ilike('filename', `%${q}%`)

  const { data, error, count } = await query
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ files: data ?? [], count: count ?? (data?.length ?? 0) })
}
