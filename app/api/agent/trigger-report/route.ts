import { NextResponse } from 'next/server'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL!
const CRON_SECRET = process.env.CRON_SECRET

export async function POST(request: Request) {
  // Auth — api key required
  const apiKey = request.headers.get('x-api-key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Call the weekly report endpoint internally
  try {
    const headers: Record<string, string> = {}
    if (!CRON_SECRET) {
      return NextResponse.json({ error: 'CRON_SECRET not configured — cannot trigger report' }, { status: 500 })
    }
    headers['Authorization'] = `Bearer ${CRON_SECRET}`

    const res = await fetch(`${SITE_URL}/api/cron/weekly-report`, {
      method: 'GET',
      headers,
    })

    const data = await res.json()
    return NextResponse.json({ success: res.ok, report: data })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to trigger report' },
      { status: 500 }
    )
  }
}
