import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/cron/vps-backup-prune
 *
 * Vercel cron — daily 04:30 UTC. Prunes old per-client VPS backups in
 * the `vps-backups` Supabase Storage bucket so we don't accumulate
 * unlimited daily snapshots.
 *
 * Retention policy:
 *   - Keep all snapshots from the last 14 days (daily granularity)
 *   - Keep the snapshot from the 1st of each month for the last 6 months
 *   - Delete everything else
 *
 * Per-client basis — each {slug}/ folder is pruned independently.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface StorageObj {
  name: string
  created_at?: string
  updated_at?: string
}

function shouldKeep(filename: string, today: Date): boolean {
  // filename pattern: YYYY-MM-DD.tar.gz
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.tar\.gz$/)
  if (!match) return true // unknown format — don't delete
  const [, y, m, d] = match
  const fileDate = new Date(`${y}-${m}-${d}T00:00:00Z`)
  if (isNaN(fileDate.getTime())) return true

  const ageDays = Math.floor((today.getTime() - fileDate.getTime()) / (24 * 60 * 60 * 1000))

  // Last 14 days — keep all
  if (ageDays <= 14) return true

  // 1st of month for last 6 months — keep
  const isFirstOfMonth = d === '01'
  if (isFirstOfMonth && ageDays <= 6 * 31) return true

  return false
}

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const today = new Date()

  // Per-client folders to enumerate. Use clients table as source of truth
  // for which slugs we expect — anything else in storage is an orphan we
  // can leave alone.
  const { data: clients } = await supabase
    .from('clients')
    .select('slug')
    .not('slug', 'is', null)

  const summary: Record<string, { kept: number; deleted: number }> = {}

  for (const client of clients || []) {
    const slug = (client as { slug: string }).slug
    if (!slug) continue

    const { data: objects, error } = await supabase
      .storage
      .from('vps-backups')
      .list(slug, { limit: 200 })

    if (error || !objects) {
      summary[slug] = { kept: 0, deleted: 0 }
      continue
    }

    const toDelete: string[] = []
    let kept = 0
    for (const obj of objects as StorageObj[]) {
      if (shouldKeep(obj.name, today)) {
        kept++
      } else {
        toDelete.push(`${slug}/${obj.name}`)
      }
    }

    if (toDelete.length > 0) {
      await supabase.storage.from('vps-backups').remove(toDelete)
    }
    summary[slug] = { kept, deleted: toDelete.length }
  }

  return NextResponse.json({ ok: true, summary })
}
