/**
 * GET /api/agent/calendar/events/cancelled?since=<iso>
 *
 * Returns calendar events that were cancelled since the given ISO timestamp.
 * Google Calendar returns cancelled events in a list call when `show_deleted=true`
 * is passed AND the event has `status: "cancelled"`.
 *
 * Used by /scan-calendar-events to detect customer-initiated cancellations.
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
      status?: string
      start?: { dateTime?: string; date?: string }
      attendees?: Array<{ email?: string; responseStatus?: string }>
    }>
  }
  error?: string
}

export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth

  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  if (!since) {
    return NextResponse.json({ error: 'since (ISO) required' }, { status: 400 })
  }

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
        // GOOGLECALENDAR_EVENTS_LIST uses camelCase params
        params: {
          calendarId: 'primary',
          updatedMin: since,
          showDeleted: true,
          maxResults: 50,
          singleEvents: true,
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

  // Only keep events marked cancelled
  const items = payload.data?.items ?? []
  const events = items
    .filter(ev => ev.status === 'cancelled')
    .map(ev => ({
      id: ev.id,
      summary: ev.summary ?? '',
      start_iso: ev.start?.dateTime ?? ev.start?.date ?? '',
      attendees: (ev.attendees ?? []).map(a => ({
        email: a.email ?? '',
        response_status: a.responseStatus ?? '',
      })),
    }))

  return NextResponse.json({ count: events.length, events })
}
