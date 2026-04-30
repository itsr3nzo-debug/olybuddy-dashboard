import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Global 404 — caught by Next when no route matches.
 *
 * Design pattern (Linear / Mercury / Stripe):
 * - Dead-centre vertical
 * - Mono "404" label, small, dim — not the page heading
 * - Sentence-case page heading, no marketing copy
 * - One primary CTA back to home, one secondary to support if needed
 * - No illustration, no gradient, no emoji
 *
 * NOTE: Uses `buttonVariants(...)` directly on Link/anchor instead of
 * `<Button asChild>` — the @base-ui Button doesn't take asChild and we
 * want a real Next.js <Link> for client-side nav.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full text-center">
        <p className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
          Error 404
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          We couldn&apos;t find that page.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          The link may be old, or the page has moved. Head back to your dashboard
          and we&apos;ll get you on track.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/dashboard" className={cn(buttonVariants({ variant: 'default' }))}>
            Back to dashboard
          </Link>
          <a
            href="mailto:hello@nexley.ai"
            className={cn(buttonVariants({ variant: 'ghost' }))}
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  )
}
