import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/jobs/<id>/schedule
 *
 * Friendly wrapper around `POST /calendarEvents` for the common case of
 * "block this job in the diary on date X from time A to time B with users".
 *
 * Body (UK-local times — agents shouldn't have to think about UTC offsets):
 * {
 *   "date":       "YYYY-MM-DD",         // e.g. "2026-05-01"
 *   "start_time": "HH:MM",              // e.g. "08:00"
 *   "end_time":   "HH:MM",              // e.g. "10:00"
 *   "user_ids":   [90387, 90388],       // first id = primary userId; rest = linkedUserIds
 *   "event_title":  "optional override",  // defaults to "Job <jobNo>: <title>"
 *   "event_type":   "JOB_PHASE",          // default; also QUOTE | ESTIMATE | OTHER
 *   "description":  "optional notes",
 *   "job_phase_id": 19683501             // optional — pin event to a specific phase
 * }
 *
 * Times are interpreted as Europe/London (BST/GMT correctness handled
 * via Intl). Agent doesn't need to know the offset.
 *
 * Returns the created Fergus calendar event.
 */

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'start_time must be HH:MM (24h)'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'end_time must be HH:MM (24h)'),
  user_ids: z.array(z.number().int().positive()).min(1).max(20),
  event_title: z.string().min(1).max(200).optional(),
  event_type: z.enum(['JOB_PHASE', 'QUOTE', 'ESTIMATE', 'OTHER']).optional(),
  description: z.string().max(2000).optional(),
  job_phase_id: z.number().int().positive().optional(),
})

/**
 * Convert "YYYY-MM-DD" + "HH:MM" interpreted as UK local time → ISO 8601 UTC.
 *
 * BST (UTC+1) applies last Sunday of March → last Sunday of October. We
 * compute the UK offset for the actual instant via Intl rather than
 * hard-coding the rule, so DST edges (e.g. clocks-forward Sunday) and
 * future rule changes stay correct.
 */
function ukLocalToUtcIso(date: string, time: string): string {
  // Step 1: parse the input string AS IF it were UTC. This gives us a
  // reference instant we can interrogate.
  const asIfUtcMs = new Date(`${date}T${time}:00Z`).getTime()
  if (!Number.isFinite(asIfUtcMs)) {
    throw new Error(`Invalid date/time: ${date} ${time}`)
  }

  // Step 2: ask Intl what the UK clock would say at that UTC instant.
  // formatToParts gives us the components without locale-formatting noise.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(asIfUtcMs))
  const o = Object.fromEntries(parts.map(p => [p.type, p.value])) as Record<string, string>
  // 'hour' may report '24' at midnight in some locales — normalise.
  const hh = o.hour === '24' ? '00' : o.hour
  const ukAsUtcMs = new Date(`${o.year}-${o.month}-${o.day}T${hh}:${o.minute}:${o.second}Z`).getTime()

  // Step 3: the UK offset (in ms) is `ukAsUtcMs - asIfUtcMs`. The actual
  // UTC instant the user MEANT is `asIfUtcMs - offset`.
  const offsetMs = ukAsUtcMs - asIfUtcMs
  return new Date(asIfUtcMs - offsetMs).toISOString()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ job_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { job_id } = await params
  const jobId = parseInt(job_id, 10)
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'invalid job_id' }, { status: 400 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const d = parsed.data

  // Validate end > start at the input level — converting first would silently
  // accept "end_time before start_time" as a tiny-positive offset due to UK DST
  // ambiguity at clocks-forward Sunday. Easier to reject up front.
  if (d.end_time <= d.start_time) {
    return NextResponse.json({ error: 'end_time must be after start_time' }, { status: 400 })
  }

  let startTimeIso: string
  let endTimeIso: string
  try {
    startTimeIso = ukLocalToUtcIso(d.date, d.start_time)
    endTimeIso = ukLocalToUtcIso(d.date, d.end_time)
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid date/time', detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  const [primaryUserId, ...linkedUserIds] = d.user_ids
  const eventType = d.event_type ?? 'JOB_PHASE'

  try {
    const client = await FergusClient.forClient(auth.clientId)

    // Default event title from the job's jobNo + title (best-effort; if the
    // lookup fails we fall back to a generic label so the schedule still
    // succeeds — the customer-facing bit is the time slot, not the label).
    let eventTitle = d.event_title
    if (!eventTitle) {
      try {
        const job = await client.getJob(jobId)
        const jobNo = (job as { jobNo?: string } | null)?.jobNo
        const title = (job as { title?: string } | null)?.title
        eventTitle = jobNo && title ? `Job ${jobNo}: ${title}` : `Job ${jobId}`
      } catch {
        eventTitle = `Job ${jobId}`
      }
    }

    const event = await client.createCalendarEvent({
      startTime: startTimeIso,
      endTime: endTimeIso,
      eventTitle,
      eventType,
      userId: primaryUserId,
      linkedUserIds: linkedUserIds.length > 0 ? linkedUserIds : undefined,
      jobId,
      jobPhaseId: d.job_phase_id,
      description: d.description,
    })

    return NextResponse.json({
      event,
      // Echo the resolved schedule so the agent can confirm to the owner
      // without having to re-parse the Fergus event payload.
      schedule: {
        job_id: jobId,
        date: d.date,
        start_time_local: d.start_time,
        end_time_local: d.end_time,
        start_time_utc: startTimeIso,
        end_time_utc: endTimeIso,
        primary_user_id: primaryUserId,
        linked_user_ids: linkedUserIds,
        event_title: eventTitle,
        event_type: eventType,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_schedule_job_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
