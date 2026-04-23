import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { emitAgentSignal, connectedFergusClients, connectedFergusXeroClients, connectedXeroClients } from '@/lib/agent-briefings/emit'
import {
  composeMorningBrief, composeWeeklyBrief, composeQuoteChase,
  composeAgedDebtorChase, composeServiceRecalls,
  composeProfitScan, composeVatSanityCheck,
  type BriefSummary,
} from '@/lib/agent-briefings/composers'

/**
 * GET /api/cron/briefings?kind=<morning|weekly|quote-chase|aged-debtor|service-recall>
 *
 * Single endpoint, multiple kinds. Vercel cron invokes each kind at its
 * scheduled time. Bearer `CRON_SECRET`.
 *
 * For each connected client, runs the relevant composer and emits a signal
 * into integration_signals. The VPS agent's polling loop picks it up and
 * WhatsApps the owner. All owner-in-the-loop — no autonomous outbound.
 */

export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

type Kind = 'morning' | 'weekly' | 'quote-chase' | 'aged-debtor' | 'service-recall' | 'profit-scan' | 'vat-sanity'
const KINDS: Kind[] = ['morning', 'weekly', 'quote-chase', 'aged-debtor', 'service-recall', 'profit-scan', 'vat-sanity']

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (cronSecret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const kind = (new URL(req.url).searchParams.get('kind') ?? 'morning') as Kind
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: 'invalid kind', allowed: KINDS }, { status: 400 })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  // Different kinds need different client sets
  let clients: Array<{ client_id: string }>
  switch (kind) {
    case 'weekly':
    case 'morning':
      clients = await connectedFergusXeroClients(sb)
      break
    case 'aged-debtor':
    case 'vat-sanity':
      clients = await connectedXeroClients(sb)
      break
    case 'quote-chase':
    case 'service-recall':
    case 'profit-scan':
      clients = await connectedFergusClients(sb)
      break
  }

  let emitted = 0
  let skipped = 0
  const errors: Array<{ client_id: string; error: string }> = []

  const emitOne = async (clientId: string, brief: BriefSummary, signalType: Parameters<typeof emitAgentSignal>[0]['signalType']) => {
    if (!brief.hasContent || !brief.summary) { skipped++; return }
    const r = await emitAgentSignal({
      sb, clientId, signalType,
      dedupKey: brief.dedupKey, summary: brief.summary,
      urgency: brief.urgency, extractedContext: brief.context,
    })
    if (r.ok) emitted++; else errors.push({ client_id: clientId, error: r.error ?? 'emit failed' })
  }

  // Process with concurrency cap
  const CONCURRENCY = 5
  for (let i = 0; i < clients.length; i += CONCURRENCY) {
    const batch = clients.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async ({ client_id }) => {
      try {
        switch (kind) {
          case 'morning': {
            const b = await composeMorningBrief(client_id)
            await emitOne(client_id, b, 'owner_briefing_morning')
            break
          }
          case 'weekly': {
            const b = await composeWeeklyBrief(client_id)
            await emitOne(client_id, b, 'owner_briefing_weekly')
            break
          }
          case 'aged-debtor': {
            const b = await composeAgedDebtorChase(client_id)
            await emitOne(client_id, b, 'xero_debtor_chase')
            break
          }
          case 'quote-chase': {
            const list = await composeQuoteChase(client_id)
            for (const b of list) await emitOne(client_id, b, 'fergus_quote_chase')
            break
          }
          case 'service-recall': {
            const list = await composeServiceRecalls(client_id)
            for (const b of list) await emitOne(client_id, b, 'fergus_service_recall')
            break
          }
          case 'profit-scan': {
            const list = await composeProfitScan(client_id)
            for (const b of list) await emitOne(client_id, b, 'fergus_profit_scan')
            break
          }
          case 'vat-sanity': {
            const list = await composeVatSanityCheck(client_id)
            for (const b of list) await emitOne(client_id, b, 'xero_vat_sanity')
            break
          }
        }
      } catch (e) {
        errors.push({ client_id, error: e instanceof Error ? e.message : String(e) })
      }
    }))
  }

  return NextResponse.json({
    kind,
    clients_processed: clients.length,
    signals_emitted: emitted,
    skipped_no_content: skipped,
    errors,
  })
}
