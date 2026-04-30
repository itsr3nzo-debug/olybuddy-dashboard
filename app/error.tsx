'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Global error boundary. Caught by Next when an unhandled error escapes
 * a server component or a route segment. Specific routes have their own
 * `error.tsx` files (calls/, dashboard/, contacts/, etc.) — this is the
 * fallback for anything not yet covered.
 *
 * Visual matches `not-found.tsx` for consistency.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Send to console for now; production SHOULD wire Sentry / similar.
    console.error('[global error boundary]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center">
        <p className="font-mono text-xs text-destructive tracking-widest uppercase">
          Something broke
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          We&apos;ve hit a snag.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          The error has been logged. Try again — if it keeps happening, let us
          know and we&apos;ll dig in.
        </p>
        {error?.digest && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground tracking-wider">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <a
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
