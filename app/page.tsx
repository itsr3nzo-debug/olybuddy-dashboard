'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    // Supabase implicit magic-link flow lands here with #access_token=... in the hash.
    // Server-side redirects strip the hash, so we MUST handle it client-side before
    // anything redirects us away.
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash && hash.includes('access_token')) {
      const supabase = createClient()
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') {
          // Clear the hash so the browser URL is clean
          window.history.replaceState({}, '', '/')
          router.replace('/dashboard')
        }
      })
      return
    }
    // No hash → normal flow: send to dashboard (middleware will redirect to /login if unauth'd)
    router.replace('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  )
}
