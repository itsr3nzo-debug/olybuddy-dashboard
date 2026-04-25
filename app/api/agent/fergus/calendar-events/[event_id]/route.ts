import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * DELETE /api/agent/fergus/calendar-events/<event_id>
 *
 * Remove a calendar event from Fergus's diary. Pairs with the
 * /jobs/{id}/schedule endpoint (which creates events) so the agent can
 * fully manage the schedule lifecycle: book → reschedule (delete + book) →
 * cancel.
 *
 * Maps to `DELETE /calendarEvents/{id}` on Fergus. No body.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ event_id: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { event_id } = await params
  const id = parseInt(event_id, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid event_id' }, { status: 400 })
  }
  try {
    const client = await FergusClient.forClient(auth.clientId)
    await client.deleteCalendarEvent(id)
    return NextResponse.json({ success: true, event_id: id })
  } catch (e) {
    return NextResponse.json(
      { error: 'fergus_delete_calendar_event_failed', detail: safeErrorDetail(e) },
      { status: 502 },
    )
  }
}
