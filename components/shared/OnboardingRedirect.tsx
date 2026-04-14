'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function OnboardingRedirect({ done }: { done: boolean }) {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (!done && !pathname.startsWith('/onboarding')) {
      router.replace('/onboarding')
    }
  }, [done, pathname, router])

  // While redirecting, show nothing (prevents flash of dashboard content)
  if (!done && !pathname.startsWith('/onboarding')) {
    return <div className="fixed inset-0 bg-background z-50" />
  }

  return null
}
