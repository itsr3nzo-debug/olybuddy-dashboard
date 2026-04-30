/**
 * GET /api/build/recent-chunks?project=mobile
 *
 * Helper for the /build/{project} status page realtime fallback. When a
 * realtime postgres_change fires, we don't trust the payload (might be
 * partial); we re-fetch the latest 15 chunks from this endpoint instead.
 *
 * Public — but only returns chunks (no PII). Status page is already
 * token-gated upstream so this is fine.
 */

import { NextRequest } from 'next/server'
import { createUntypedServiceClient } from '@/lib/supabase/untyped'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') ?? 'mobile'

  const sb = createUntypedServiceClient()
  const { data, error } = await sb
    .from('build_chunks')
    .select(
      'id, title, summary, status, typecheck_status, started_at, completed_at, commit_sha, preview_url, screenshot_urls'
    )
    .eq('project_slug', project)
    .order('started_at', { ascending: false })
    .limit(15)

  if (error) {
    return Response.json({ items: [], error: error.message }, { status: 500 })
  }

  return Response.json({ items: data ?? [] })
}
