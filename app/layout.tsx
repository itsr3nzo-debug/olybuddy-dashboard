import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Analytics } from '@vercel/analytics/react'
import { Toaster } from 'sonner'
import { Inter } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

export const metadata: Metadata = {
  title: 'Nexley AI | AI Employee Dashboard',
  description: 'Monitor your AI Employee — calls, leads, and appointments.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Item #6 — staging banner. Renders a yellow strip whenever the deploy
  // is the staging env (NEXT_PUBLIC_SITE_URL contains "staging" OR explicit
  // NEXT_PUBLIC_ENV=staging). Catches mistakes where someone navigates to
  // the staging URL thinking it's production. Production never trips this.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const isStaging = process.env.NEXT_PUBLIC_ENV === 'staging' || siteUrl.includes('staging')

  return (
    <html lang="en" suppressHydrationWarning className={cn('font-sans', inter.variable)}>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {isStaging && (
            <div className="bg-yellow-400 text-yellow-950 text-center text-xs font-bold tracking-wide py-1.5 px-3 sticky top-0 z-[300]">
              STAGING ENVIRONMENT — TEST DATA ONLY · DO NOT ENTER REAL CARDS
            </div>
          )}
          {children}
          <Toaster
            position="top-right"
            richColors
            closeButton
            duration={5000}
            toastOptions={{
              className: 'text-sm',
            }}
          />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
