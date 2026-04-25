import { NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { getReferralStats } from '@/lib/referrals'

/**
 * GET /api/referrals/me
 *
 * Returns the current user's referral code, share URL, and progress
 * (count of pending/credited, total saved, # to next free month). Drives
 * the ReferralCard component on the dashboard + billing settings.
 */
export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = user.app_metadata?.client_id as string | undefined
  if (!clientId) return NextResponse.json({ error: 'No client linked' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexley.vercel.app'
  const stats = await getReferralStats(clientId, siteUrl)

  return NextResponse.json(stats)
}
