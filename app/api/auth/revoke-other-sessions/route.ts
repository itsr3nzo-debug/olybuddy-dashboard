import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Called after a password change. Signs out all OTHER refresh tokens for
 * this user so an attacker who had the old password can't linger on a
 * different device.
 */
export async function POST() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // signOut('others') revokes all refresh tokens except the current session's
  await supabase.auth.signOut({ scope: 'others' })
  return NextResponse.json({ ok: true })
}
