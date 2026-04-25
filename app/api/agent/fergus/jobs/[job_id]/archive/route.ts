import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/archive
 *
 * IMPORTANT — Fergus Partner API has NO archive endpoint for jobs.
 * Verified against api.fergus.com/docs/json — only `/sites/{id}/archive`
 * exists. This route emulates archive via `POST /jobs/{id}/hold` with a
 * far-future `hold_until` (5y default) and an explanatory note. Net effect:
 * the job leaves active views, surfaces in "On Hold" filters, and is
 * recoverable via /restore (which calls resume).
 *
 * Body (all optional):
 *   {
 *     "note":       "Why archived (free text)",  // default flags this as archive-intent
 *     "hold_until": "YYYY-MM-DD"                  // override the 5y far-future default
 *   }
 *
 * Response:
 *   { "job": <fergus job>, "action": "archive", "implementation": "hold", "hold_until": "..." }
 */

const Body = z.object({
  note: z.string().max(2000).optional(),
  hold_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict().partial()

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const id = parseInt(job_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  // Body is optional; empty body = use defaults.
  const raw = await req.json().catch(() => ({}))
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const job = await client.archiveJob(id, {
      note: parsed.data.note,
      holdUntil: parsed.data.hold_until,
    })
    return NextResponse.json({
      job,
      action: 'archive',
      implementation: 'hold',
      // Echo the resolved hold_until so the caller knows what the far-future
      // default was (and can pass a different one next time if they want).
      hold_until: parsed.data.hold_until ?? null,
      note:
        'Fergus has no archive endpoint for jobs (only sites). This route ' +
        'effects archive via /jobs/{id}/hold with a far-future date. Restore ' +
        'with POST /jobs/{id}/restore.',
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_archive_job_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
