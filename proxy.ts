import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Pages blocked for 'member' role (synced with lib/rbac.ts MEMBER_BLOCKED_PAGES)
const MEMBER_BLOCKED = ['/settings', '/integrations']
// Pages only for 'super_admin'
const ADMIN_ONLY = ['/admin']
// Public pages that don't require auth
const PUBLIC_PATHS = ['/login', '/signup', '/auth', '/security']

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
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
