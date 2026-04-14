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
  return (
    <html lang="en" suppressHydrationWarning className={cn('font-sans', inter.variable)}>
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
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
