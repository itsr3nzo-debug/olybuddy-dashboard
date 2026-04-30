/**
 * GET /api/build/progress?project=mobile&key=<token>
 *
 * Polling endpoint for the /build/{project} status page (replaces the
 * Supabase realtime subscription that needed extra config to work).
 *
 * Token-gated like the page itself.
 */

import { NextRequest } from 'next/server'
import { getProgress, validateBuildToken } from '@/lib/build/progress'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') ?? 'mobile'
  const key = request.nextUrl.searchParams.get('key') ?? ''
  if (!key) return new Response('Missing key', { status: 401 })

  const validated = await validateBuildToken(key)
  if (!validated || validated !== project) {
    return new Response('Invalid token', { status: 401 })
  }

  const { progress, recentChunks } = await getProgress(project)
  return Response.json({ progress, recentChunks })
}
