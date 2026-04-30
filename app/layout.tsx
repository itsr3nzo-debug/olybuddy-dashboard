import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Analytics } from '@vercel/analytics/react'
import { Toaster } from 'sonner'
import { Geist, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'

// Geist replaces Inter as part of the v2 design refresh. Inter is the default
// in every AI-tooled SaaS and reads "generic"; Geist is uncommon enough to
// register as deliberate, free, well-engineered, and ships from Vercel —
// optimised for tabular UIs (which is most of the dashboard).
//
// Mono is reserved for tabular figures (phone numbers, message counts,
// timestamps, customer IDs, monetary amounts) — paired with `tabular-nums`
// so digits align across rows.
const geistSans = Geist({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Nexley AI | AI Employee Dashboard',
  description: 'Monitor your AI Employee — calls, leads, and appointments.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Staging banner — yellow strip whenever NEXT_PUBLIC_SITE_URL contains
  // "staging" OR NEXT_PUBLIC_ENV=staging. Catches mistakes where someone
  // navigates to staging thinking it's production.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const isStaging = process.env.NEXT_PUBLIC_ENV === 'staging' || siteUrl.includes('staging')

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('font-sans', geistSans.variable, geistMono.variable)}
    >
      <body className="min-h-full flex flex-col antialiased">
        {/* Skip-to-content for keyboard / screenreader users. Hidden until
            focused. The first :focus on every dashboard page hits this link
            so users can jump past sidebar / banners / breadcrumb chrome. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[400] focus:rounded-md focus:bg-foreground focus:text-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {isStaging && (
            <div className="bg-warning/15 text-warning border-b border-warning/30 text-center text-2xs font-medium uppercase tracking-wider py-1.5 px-3 sticky top-0 z-[300]">
              Staging environment — test data only — do not enter real cards
            </div>
          )}
          {children}
          {/*
            Sonner toaster — v2.5 motion-system pass.
            - position top-right (unchanged)
            - richColors KEPT (semantic green/red is functional)
            - closeButton on for explicit dismissal
            - duration 5000ms default; action toasts override to longer
            - theme="dark" so dark vars resolve in the toast component itself
              (Sonner reads CSS vars; without explicit theme it falls back
              to system which is wrong on a dark-default app)
            - Custom motion via toastOptions.style — 200ms ease-out entrance
              with a 1px hairline border + the dialog-tier soft shadow.
              cubic-bezier(0.16, 1, 0.3, 1) is the Linear/Plain entrance curve
              — has a slight overshoot that reads "placed" rather than "thrown".
            - unstyled defaults turned off; we keep richColors but layer our
              own tokens on top via inline style.
          */}
          <Toaster
            position="top-right"
            theme="dark"
            richColors
            closeButton
            duration={5000}
            visibleToasts={4}
            offset="20px"
            toastOptions={{
              className: 'text-sm font-sans',
              style: {
                fontFamily: 'var(--font-sans)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
                fontFeatureSettings: '"cv11", "ss01", "tnum"',
              },
            }}
          />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
