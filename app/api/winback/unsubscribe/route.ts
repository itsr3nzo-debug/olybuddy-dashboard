import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/winback/unsubscribe?id={winback_sequence.id}
 *
 * One-click unsubscribe link in winback emails. Sets unsubscribed_at on
 * the row so the cron stops emailing them. Idempotent.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://nexley.vercel.app'}/?unsub=missing`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  await supabase
    .from('winback_sequence')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://nexley.vercel.app'}/?unsub=ok`)
}
