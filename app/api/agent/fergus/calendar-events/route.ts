import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/calendar-events
 *
 * Create a Fergus calendar event — scheduling a visit, quote, estimate,
 * or other appointment. Wraps Fergus `POST /calendarEvents`.
 *
 * Body: `{start_time, end_time, event_title, event_type, user_id?, linked_user_ids?, job_id?, job_phase_id?, description?}`
 * Times must be ISO-8601 UTC (e.g. "2026-04-30T09:00:00.000Z").
 */
const Body = z.object({
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }),
  event_title: z.string().min(1).max(200),
  event_type: z.enum(['JOB_PHASE', 'QUOTE', 'ESTIMATE', 'OTHER']),
  user_id: z.number().int().positive().optional(),
  linked_user_ids: z.array(z.number().int().positive()).max(20).optional(),
  job_id: z.number().int().positive().optional(),
  job_phase_id: z.number().int().positive().optional(),
  description: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  const d = parsed.data
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const event = await client.createCalendarEvent({
      startTime: d.start_time,
      endTime: d.end_time,
      eventTitle: d.event_title,
      eventType: d.event_type,
      userId: d.user_id,
      linkedUserIds: d.linked_user_ids,
      jobId: d.job_id,
      jobPhaseId: d.job_phase_id,
      description: d.description,
    })
    return NextResponse.json({ event })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_create_calendar_event_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
