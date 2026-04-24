/**
 * GET  /api/vault/projects  → list projects for the resolved client
 * POST /api/vault/projects  → create a new project
 *
 * Resolver: owner/member pinned to app_metadata.client_id; super_admin may
 * pass ?client=<uuid>. Matches the agent_chat_sessions route pattern so
 * ops-staff expectations are consistent across the dashboard.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveClientId } from '@/lib/chat/resolve-client'

function writerFor(isAdmin: boolean, userClient: Awaited<ReturnType<typeof createClient>>) {
  return isAdmin
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
    : userClient
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const explicit = new URL(req.url).searchParams.get('client') || undefined
  const { clientId, isAdminOverride } = resolveClientId(user, explicit)
  if (!clientId) return NextResponse.json({ projects: [] })

  const reader = writerFor(isAdminOverride, supabase)
  const { data, error } = await reader
    .from('vault_projects')
    .select('id, name, description, created_at, archived_at')
    .eq('client_id', clientId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach file counts — single extra query so the table view isn't N+1.
  const ids = (data ?? []).map(p => p.id)
  let counts: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: rows } = await reader
      .from('vault_files')
      .select('project_id')
      .in('project_id', ids)
      .is('deleted_at', null)
    for (const row of rows ?? []) {
      counts[row.project_id] = (counts[row.project_id] ?? 0) + 1
    }
  }

  return NextResponse.json({
    projects: (data ?? []).map(p => ({ ...p, file_count: counts[p.id] ?? 0 })),
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let name = 'Untitled project'
  let description: string | null = null
  let explicit: string | undefined
  try {
    const body = await req.json()
    if (typeof body?.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, 120)
    if (typeof body?.description === 'string') description = body.description.slice(0, 500)
    if (typeof body?.client_id === 'string') explicit = body.client_id
  } catch {
    // malformed JSON — use defaults, tenant resolves from JWT
  }

  const { clientId, isAdminOverride, spoofRejected } = resolveClientId(user, explicit)
  if (spoofRejected) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 })

  const writer = writerFor(isAdminOverride, supabase)
  const { data, error } = await writer
    .from('vault_projects')
    .insert({ client_id: clientId, name, description, created_by: user.id })
    .select('id, name, description, created_at, archived_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ project: { ...data, file_count: 0 } })
}
