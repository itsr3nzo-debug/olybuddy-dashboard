'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * This page handles Supabase auth callbacks. Three input shapes are supported:
 *
 * 1. Hash fragment: `#access_token=…&refresh_token=…` (implicit flow — older
 *    Supabase recovery / magic link emails).
 * 2. Query param: `?code=…` (PKCE flow — modern signInWithOAuth path).
 * 3. Query param: `?token_hash=…&type=…` (OTP flow — added 2026-05-20 so
 *    team-invite, team-resend, and onboard-client can bypass Supabase's
 *    server-side verify hop, which honours the project's stale redirect-URL
 *    allowlist. Tokens are extracted from `linkData.properties.action_link`
 *    via `lib/auth/action-link.ts` and routed here so verifyOtp() mints the
 *    session client-side with no Supabase URL config involved).
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

    const params = new URLSearchParams(window.location.search)

    // Check for OTP token (custom email routes bypassing Supabase's hop).
    // Whitelist `type` so we don't pass arbitrary strings into verifyOtp.
    const tokenHash = params.get('token_hash')
    const typeParam = params.get('type')
    const ALLOWED_TYPES = ['magiclink', 'recovery', 'invite', 'email', 'signup'] as const
    type AllowedType = (typeof ALLOWED_TYPES)[number]
    if (tokenHash) {
      const type: AllowedType =
        typeParam && (ALLOWED_TYPES as readonly string[]).includes(typeParam)
          ? (typeParam as AllowedType)
          : 'magiclink'
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
        if (!error) {
          router.replace('/dashboard')
        } else {
          router.replace('/login?error=auth_callback_failed')
        }
      })
      return
    }

    // Check for code param (PKCE flow)
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
