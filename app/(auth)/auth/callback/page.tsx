'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * This page handles Supabase magic link callbacks.
 * Supabase redirects here with either:
 * - Hash fragment: #access_token=...&refresh_token=... (implicit flow)
 * - Query param: ?code=... (PKCE flow, handled by route.ts)
 *
 * The hash fragment is only visible client-side, so we need this page
 * to extract it and set the session.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Check for hash fragment (implicit flow from magic links)
    const hash = window.location.hash
    if (hash) {
      // Supabase client automatically picks up the hash fragment
      // and sets the session via onAuthStateChange
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') {
          router.replace('/dashboard')
        }
      })
      return
    }

    // Check for code param (PKCE flow)
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (!error) {
          router.replace('/dashboard')
        } else {
          router.replace('/login?error=auth_callback_failed')
        }
      })
      return
    }

    // No auth params — redirect to login
    router.replace('/login?error=auth_callback_failed')
  }, [router, supabase])

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Signing you in...</p>
      </div>
    </div>
  )
}
