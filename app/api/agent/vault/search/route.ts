/**
 * GET /api/agent/vault/search?q=<text>&project_id=<uuid?>&limit=<n?>
 *
 * Full-text search over extracted_text for the authenticated agent's
 * client. Returns ranked snippets so the agent can decide which files are
 * relevant before pulling the full text via /api/agent/vault/file.
 *
 * Response shape:
 *   {
 *     count,
 *     matches: [{
 *       file_id, filename, project_id, project_name, rank,
 *       snippet,           // websearch-style highlight, ~300 chars
 *       page_count, size_bytes, mime_type, uploaded_at
 *     }]
 *   }
 *
 * Ranking: ts_rank_cd on websearch_to_tsquery(q). If `q` is empty we
 * return recent files instead — lets the agent list Vault without knowing
 * any keywords.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { vaultService } from '@/lib/vault/server'

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const projectId = url.searchParams.get('project_id') || null
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50)

  const svc = vaultService()

  try {
    if (q.length >= 2) {
      // Parameterised SQL — $1 client_id, $2 query, $3 project filter (nullable), $4 limit.
      // ts_headline trims to ~300 chars around the first match; fallback to
      // the first 300 chars of extracted_text if no match (shouldn't happen
      // when FTS returns a row, but defensive).
      const { data, error } = await svc.rpc('vault_search', {
        p_client_id: auth.clientId,
        p_query: q,
        p_project_id: projectId,
        p_limit: limit,
      })
      if (!error) {
        return NextResponse.json({ count: data?.length ?? 0, matches: data ?? [] })
      }
      // If the RPC doesn't exist yet (migration hasn't been applied to this
      // env), fall through to the plain ILIKE below so the endpoint still
      // behaves — we log once and continue.
      console.warn('[vault_search] RPC missing, falling back to ILIKE:', error.message)
    }

    // Empty-query path or FTS fallback: plain metadata listing + ILIKE.
    let query = svc
      .from('vault_files')
      .select('id, filename, project_id, extracted_text, page_count, size_bytes, mime_type, uploaded_at, vault_projects(name)')
      .eq('client_id', auth.clientId)
      .is('deleted_at', null)
      .eq('status', 'ready')
    if (projectId) query = query.eq('project_id', projectId)
    if (q.length >= 2) query = query.ilike('extracted_text', `%${q}%`)
    const { data, error } = await query.order('uploaded_at', { ascending: false }).limit(limit)
    if (error) {
      return NextResponse.json({ error: 'vault_search_failed', detail: safeErrorDetail(error) }, { status: 502 })
    }

    const matches = (data ?? []).map(row => {
      // Naive snippet: first occurrence of q in extracted_text, ±150 chars.
      const text = row.extracted_text ?? ''
      let snippet: string
      if (q && text) {
        const idx = text.toLowerCase().indexOf(q.toLowerCase())
        if (idx >= 0) {
          const start = Math.max(0, idx - 150)
          const end = Math.min(text.length, idx + q.length + 150)
          snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
        } else {
          snippet = text.slice(0, 300)
        }
      } else {
        snippet = text.slice(0, 300)
      }
      const projJoin = row.vault_projects as unknown as { name: string } | { name: string }[] | null
      const proj = Array.isArray(projJoin) ? (projJoin[0] ?? null) : projJoin
      return {
        file_id: row.id,
        filename: row.filename,
        project_id: row.project_id,
        project_name: proj?.name ?? null,
        rank: null,
        snippet,
        page_count: row.page_count,
        size_bytes: row.size_bytes,
        mime_type: row.mime_type,
        uploaded_at: row.uploaded_at,
      }
    })

    return NextResponse.json({ count: matches.length, matches })
  } catch (e) {
    return NextResponse.json({ error: 'vault_search_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
