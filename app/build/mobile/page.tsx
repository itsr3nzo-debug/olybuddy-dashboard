/**
 * /build/mobile?key=<token>
 *
 * Live build-progress page for the Nexley Mobile project. Mobile-first,
 * server-rendered initial state + Supabase realtime subscription for
 * subsequent updates. Token-gated (server-side validates against
 * build_tokens table).
 *
 * Visibility design (DA-revised):
 *   - Server renders the latest snapshot so refresh-without-JS works (D12)
 *   - Realtime sub layers on top so open tabs update in <2s
 *   - Token in URL query, not headers (you bookmark it on phone home screen)
 *   - 5am Europe/London "today" boundary, not UTC midnight (D7)
 *   - Renders TodoWrite list verbatim (D13)
 *   - Shows typecheck status per chunk (D14)
 *   - Embedded Loom video for milestone chunks (D11)
 */

import { redirect } from 'next/navigation'
import { getProgress, validateBuildToken } from '@/lib/build/progress'
import { BuildPageClient } from './BuildPageClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ key?: string }>
}

export default async function BuildMobilePage({ searchParams }: PageProps) {
  const { key } = await searchParams

  if (!key) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-[#0a0a0b] text-white">
        <p className="text-sm text-white/60">Missing token.</p>
      </main>
    )
  }

  const project = await validateBuildToken(key)
  if (!project) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 bg-[#0a0a0b] text-white">
        <div className="text-center">
          <p className="text-sm text-white/60 mb-2">Token expired or invalid.</p>
          <p className="text-xs text-white/40">Get a new link from the build owner.</p>
        </div>
      </main>
    )
  }

  if (project !== 'mobile') {
    redirect(`/build/${project}?key=${encodeURIComponent(key)}`)
  }

  const initial = await getProgress('mobile')
  return <BuildPageClient initialProgress={initial.progress} initialChunks={initial.recentChunks} token={key} />
}
