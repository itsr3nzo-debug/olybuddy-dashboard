/**
 * GET /api/agent/calendar/events/list?time_min=<iso>&time_max=<iso>
 *
 * Lists Google Calendar events for the authenticated agent's client. Used by
 * /scan-calendar-events to detect upcoming-unprepared meetings + conflicts.
 *
 * Tokens are held by Composio (OAuth path B). We call Composio's REST API to
 * execute GOOGLECALENDAR_EVENTS_LIST.
 *
 * If Google Calendar isn't connected for this client, returns 409 with
 * "google_calendar not connected" — scanner treats as empty, no error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { createClient } from '@supabase/supabase-js'

interface ComposioExecuteResponse {
  successful?: boolean
  data?: {
    items?: Array<{
      id: string
      summary?: string
      description?: string
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      status?: string
      attendees?: Array<{ email?: string; responseStatus?: string }>
      organizer?: { email?: string }
      location?: string
    }>
  }
  error?: string
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const timeMin = url.searchParams.get('time_min')
  const timeMax = url.searchParams.get('time_max')

  if (!timeMin || !timeMax) {
    return NextResponse.json(
      { error: 'time_min and time_max (ISO) required' },
      { status: 400 },
    )
  }

  // Confirm calendar is connected
  const sb = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: integration } = await sb
    .from('integrations')
    .select('provider, status')
    .eq('client_id', auth.clientId)
    .eq('provider', 'google_calendar')
    .eq('status', 'connected')
    .single()

  if (!integration) {
    return NextResponse.json(
      { error: 'google_calendar not connected', events: [] },
      { status: 409 },
    )
  }

  const res = await fetch(
    `https://backend.composio.dev/api/v3/actions/GOOGLECALENDAR_EVENTS_LIST/execute`,
    {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPOSIO_API_KEY!,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        entity_id: auth.clientId,
        // GOOGLECALENDAR_EVENTS_LIST uses camelCase params (verified against
        // https://backend.composio.dev/api/v3/tools/GOOGLECALENDAR_EVENTS_LIST)
        params: {
          calendarId: 'primary',
          timeMin: timeMin,
          timeMax: timeMax,
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        },
      }),
    },
  ).catch(e => ({ ok: false, error: e } as { ok: false; error: unknown }))

  if (!('ok' in res) || !res.ok) {
    return NextResponse.json(
      { error: 'Composio call failed', detail: safeErrorDetail((res as { error?: unknown }).error ?? res), events: [] },
      { status: 502 },
    )
  }

  const payload = (await res.json()) as ComposioExecuteResponse
  if (!payload.successful) {
    return NextResponse.json(
      { error: 'Calendar fetch failed', detail: safeErrorDetail(payload.error), events: [] },
      { status: 502 },
    )
  }

  const items = payload.data?.items ?? []
  const events = items.map(ev => ({
    id: ev.id,
    summary: ev.summary ?? '',
    description: ev.description ?? '',
    start_iso: ev.start?.dateTime ?? ev.start?.date ?? '',
    end_iso: ev.end?.dateTime ?? ev.end?.date ?? '',
    status: ev.status ?? '',
    attendees: (ev.attendees ?? []).map(a => ({
      email: a.email ?? '',
      response_status: a.responseStatus ?? '',
    })),
    organiser: ev.organizer?.email ?? '',
    location: ev.location ?? '',
  }))

  return NextResponse.json({ count: events.length, events })
}
