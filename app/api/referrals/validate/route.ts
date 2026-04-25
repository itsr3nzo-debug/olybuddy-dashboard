import { NextRequest, NextResponse } from 'next/server'
import { findReferrer } from '@/lib/referrals'

/**
 * GET /api/referrals/validate?code=<ref>
 *
 * Public, unauthenticated endpoint used by the signup wizard to confirm
 * the referral code in ?ref= is recognised before attribution. Returns
 * { valid: boolean, referrer: { name } } — only the business name, never
 * the email or any PII.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') || ''
  const referrer = await findReferrer(code)
  if (!referrer) {
    return NextResponse.json({ valid: false }, { status: 200 })
  }
  return NextResponse.json({
    valid: true,
    referrer: { name: referrer.name },
  })
}
