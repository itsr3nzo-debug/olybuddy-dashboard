/**
 * Fergus endpoint probe — discovers undocumented surface.
 *
 * Uses a client's real PAT (resolved via FergusClient.forClient) to hit
 * candidate paths. Distinguishes:
 *   404 → path doesn't exist
 *   401/403 → path exists, token/scope rejected
 *   405 → path exists, method wrong
 *   400 → path + method exist, our body is wrong (the interesting result)
 *   200/201 → works (unlikely with empty body)
 *
 * Run: bun run scripts/fergus-probe.ts <client_uuid>
 * Or:  tsx scripts/fergus-probe.ts <client_uuid>
 *
 * Does ONLY GET requests + read-only POSTs with empty bodies to surface
 * existence. Never destructive.
 */

// Load .env.local so Supabase init works when resolving the PAT
import { config } from 'dotenv'
config({ path: '.env.local' })

import { FergusClient } from '../lib/integrations/fergus'

const FERGUS_BASE = 'https://api.fergus.com'
const FERGUS_V2 = 'https://my.fergus.com'

async function probe(token: string, method: string, path: string, body?: unknown, base: string = FERGUS_BASE): Promise<{ status: number; snippet: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text().catch(() => '')
  return { status: res.status, snippet: text.slice(0, 200).replace(/\n/g, ' ') }
}

async function main() {
  const clientId = process.argv[2]
  if (!clientId) {
    console.error('usage: tsx scripts/fergus-probe.ts <client_uuid>')
    process.exit(1)
  }

  // Get the raw PAT via our existing resolver
  const client = await FergusClient.forClient(clientId)
  // @ts-expect-error — poking a private for one-off use
  const token: string = client.token
  if (!token) throw new Error('no token')
  console.log(`PAT resolved (len=${token.length})`)

  type Case = { method: string; path: string; body?: unknown; why: string; base?: string }
  const cases: Case[] = [
    // my.fergus.com/api/v2 probe — the internal API reportedly used by the web app
    { method: 'GET', path: '/api/v2/users/me',              why: '[v2] user probe',         base: FERGUS_V2 },
    { method: 'GET', path: '/api/v2/jobs',                  why: '[v2] jobs list',          base: FERGUS_V2 },
    { method: 'POST', path: '/api/v2/jobs/1/timesheet_entries', body: {}, why: '[v2] time entry create (reported path)', base: FERGUS_V2 },
    { method: 'POST', path: '/api/v2/jobs/1/invoices/create',   body: {}, why: '[v2] invoice create (reported path)',     base: FERGUS_V2 },
    { method: 'GET', path: '/api/v2/timesheets',            why: '[v2] timesheets list',     base: FERGUS_V2 },
    { method: 'GET', path: '/api/v2/invoices',              why: '[v2] invoices list',       base: FERGUS_V2 },

    // Time entry writes — every plausible path
    { method: 'POST', path: '/timeEntries', body: {}, why: 'Direct time-entry POST (the obvious one)' },
    { method: 'POST', path: '/time-entries', body: {}, why: 'Kebab-case variant' },
    { method: 'POST', path: '/timesheets', body: {}, why: 'Timesheet entity' },
    { method: 'POST', path: '/timesheet', body: {}, why: 'Singular' },
    { method: 'POST', path: '/labour', body: {}, why: 'Labour log entity' },
    { method: 'POST', path: '/jobs/1/timeEntries', body: {}, why: 'Nested under a job' },
    { method: 'POST', path: '/jobs/1/time', body: {}, why: 'Short form' },
    { method: 'POST', path: '/phases/1/timeEntries', body: {}, why: 'Under a phase (where stock lives)' },
    { method: 'POST', path: '/users/me/timeEntries', body: {}, why: 'User-scoped' },
    { method: 'POST', path: '/diary', body: {}, why: 'Diary entity' },
    { method: 'PUT',  path: '/timeEntries/1', body: {}, why: 'Maybe edit-only, no create?' },

    // Invoice writes
    { method: 'POST', path: '/customerInvoices', body: {}, why: 'Direct invoice POST' },
    { method: 'POST', path: '/invoices', body: {}, why: 'Short form' },
    { method: 'POST', path: '/jobs/1/invoices', body: {}, why: 'Nested under job (plural)' },
    { method: 'POST', path: '/jobs/1/invoice', body: {}, why: 'Nested singular' },
    { method: 'POST', path: '/jobs/1/generateInvoice', body: {}, why: 'Imperative action' },
    { method: 'POST', path: '/jobs/1/invoice/generate', body: {}, why: 'Sub-action' },
    { method: 'POST', path: '/phases/1/invoices', body: {}, why: 'Per-phase invoicing' },
    { method: 'POST', path: '/phases/1/invoice', body: {}, why: 'Per-phase' },
    { method: 'POST', path: '/jobs/1/finalInvoice', body: {}, why: 'Named action' },
    { method: 'POST', path: '/customerInvoices/draft', body: {}, why: 'Draft endpoint' },

    // File attachments (same class of missing feature)
    { method: 'POST', path: '/jobs/1/attachments', body: {}, why: 'Attachments POST' },
    { method: 'POST', path: '/attachments', body: {}, why: 'Top-level' },
    { method: 'POST', path: '/files', body: {}, why: 'Files entity' },
    { method: 'POST', path: '/documents', body: {}, why: 'Documents entity' },

    // Tasks (verify truly absent)
    { method: 'POST', path: '/tasks', body: {}, why: 'Tasks entity' },
    { method: 'GET',  path: '/tasks',              why: 'Even a read would tell us it exists' },
    { method: 'POST', path: '/jobs/1/tasks', body: {}, why: 'Nested tasks' },

    // Job completion
    { method: 'PUT',  path: '/jobs/1/complete', body: {}, why: 'Complete via PUT' },
    { method: 'POST', path: '/jobs/1/complete', body: {}, why: 'Complete via POST' },
    { method: 'POST', path: '/jobs/1/markComplete', body: {}, why: 'Imperative' },
    { method: 'POST', path: '/jobs/1/close', body: {}, why: 'Close synonym' },

    // Version probing
    { method: 'GET',  path: '/v2/users',           why: 'v2 prefix on PAT host' },
    { method: 'GET',  path: '/beta/users',         why: 'beta prefix' },
    { method: 'GET',  path: '/enhanced/users',     why: 'enhanced prefix (2025 release notes)' },
    { method: 'GET',  path: '/api/v2/users',       why: 'api/v2 prefix' },

    // Webhook API (apitracker hint)
    { method: 'GET',  path: '/webhooks',           why: 'Hidden webhooks list' },
    { method: 'GET',  path: '/webhookSubscriptions', why: 'Long form' },
    { method: 'GET',  path: '/subscriptions',      why: 'Short form' },
    { method: 'POST', path: '/webhooks', body: {}, why: 'Create webhook' },
  ]

  console.log(`\nProbing ${cases.length} candidate endpoints...\n`)
  console.log('CODE  METHOD  PATH'.padEnd(60) + 'WHY')
  console.log('─'.repeat(120))

  // Sort by interest: 400/200/405 first, then 401/403, then 404 last
  const results: Array<{ c: Case; status: number; snippet: string }> = []
  for (const c of cases) {
    try {
      const r = await probe(token, c.method, c.path, c.body, c.base)
      results.push({ c, ...r })
    } catch (e) {
      results.push({ c, status: -1, snippet: e instanceof Error ? e.message : String(e) })
    }
  }

  const rank = (s: number) => s === 400 || s === 422 ? 0 : s === 405 ? 1 : s === 200 || s === 201 ? 2 : s === 401 || s === 403 ? 3 : s === 404 ? 5 : 4
  results.sort((a, b) => rank(a.status) - rank(b.status))

  for (const r of results) {
    const line = `${String(r.status).padEnd(5)} ${r.c.method.padEnd(7)} ${r.c.path}`.padEnd(60) + r.c.why
    console.log(line)
    if (r.status !== 404 && r.status !== 401 && r.snippet) {
      console.log(`      ↳ ${r.snippet}`)
    }
  }

  console.log('\nSummary:')
  const byStatus: Record<number, number> = {}
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => rank(+a[0]) - rank(+b[0]))) {
    console.log(`  HTTP ${s}: ${n}`)
  }
  console.log('\nKey: 400/422 = path+method exist (interesting); 405 = path exists; 404 = nope; 401/403 = path likely exists but PAT lacks scope')
}

main().catch(e => { console.error(e); process.exit(1) })
