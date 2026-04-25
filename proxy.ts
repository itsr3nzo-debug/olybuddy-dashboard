import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages blocked for 'member' role (synced with lib/rbac.ts MEMBER_BLOCKED_PAGES)
const MEMBER_BLOCKED = ['/settings', '/integrations']
// Pages only for 'super_admin'
const ADMIN_ONLY = ['/admin']
// Public pages that don't require auth
const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/security', '/forgot-password', '/reset-password', '/api/auth/request-reset']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  const isApi = pathname.startsWith('/api/')

  // Unauthenticated users: redirect to login (login has a "Sign up" link)
  if (!user && !isPublic && !isApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authenticated users visiting login or signup: send to dashboard
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Redirect removed pages to dashboard (old bookmarks, etc)
  const REMOVED_PAGES = ['/performance', '/reporting', '/money', '/reviews', '/agent-logs']
  if (user && REMOVED_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // RBAC: Block members from restricted pages
  if (user) {
    const role = user.app_metadata?.role ?? 'member'

    if (role === 'member' && MEMBER_BLOCKED.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    if (role !== 'super_admin' && ADMIN_ONLY.some(p => pathname.startsWith(p))) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }

    // ─── Onboarding gate ───
    // Runs BEFORE any render. Fast path: read onboarding_completed straight
    // from the JWT's app_metadata (zero DB round-trip). Slow path: fall back
    // to a clients-table lookup for users whose metadata claim is missing
    // (e.g. signed up before the claim was rolled out).
    //
    // Round-3 fix: pending_payment users bypass /onboarding entirely and
    // land on /settings/billing — they can't legitimately complete onboarding
    // (or accept Terms) before paying. Without this, a user who abandoned the
    // Stripe Checkout could fill in the onboarding flow + accept terms
    // without ever paying. /settings/billing now shows a "Resume payment"
    // button for these users.
    if (role !== 'super_admin' && !isApi && !isPublic) {
      const meta = user.app_metadata as { client_id?: string; onboarding_completed?: boolean } | undefined
      const clientId = meta?.client_id

      if (clientId) {
        let done: boolean
        let subscriptionStatus: string | null = null

        if (meta?.onboarding_completed === true) {
          // Fast path: JWT says done → trust. Covers ~99% of production traffic
          // since every request from an onboarded user skips the DB entirely.
          // We don't fetch subscription_status here — onboarded users already
          // paid; if subscription_status is stale, /settings/billing handles it.
          done = true
        } else {
          // JWT says false OR claim missing. Verify against the DB: the user
          // might have JUST finished onboarding and their JWT is still the old
          // one that predates the app_metadata update. Trusting the JWT here
          // would cause an infinite /dashboard ↔ /onboarding redirect loop.
          //
          // Also fetch subscription_status while we're at it — pending_payment
          // users get redirected to /settings/billing instead of /onboarding.
          const { data: client } = await supabase
            .from('clients')
            .select('onboarding_completed, subscription_status')
            .eq('id', clientId)
            .maybeSingle()
          done = client?.onboarding_completed ?? false
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subscriptionStatus = ((client as any)?.subscription_status as string | undefined) ?? null
        }

        const onOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/')
        const onBilling = pathname === '/settings/billing' || pathname.startsWith('/settings/billing/')

        // pending_payment override: don't let users wander into /onboarding
        // before they've paid. Send them to billing where they can complete
        // payment or hit "Resume payment". Allowed on /settings/billing
        // itself (or they'd be in a redirect loop).
        if (!done && subscriptionStatus === 'pending_payment') {
          if (!onBilling) {
            const url = request.nextUrl.clone()
            url.pathname = '/settings/billing'
            return NextResponse.redirect(url)
          }
          // Already on billing — let them stay.
          return supabaseResponse
        }

        if (!done && !onOnboarding) {
          const url = request.nextUrl.clone()
          url.pathname = '/onboarding'
          return NextResponse.redirect(url)
        }
        if (done && onOnboarding) {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
