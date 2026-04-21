import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

interface DlqEntry {
  id: number
  provider: string
  reason: string
  body: string | null
  received_at: string
}

export default async function WebhookDlqPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>
}) {
  const sp = await searchParams
  const providerFilter = sp.provider ?? ''

  // Dashboard-auth — must be super_admin
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')
  const role = user.app_metadata?.role ?? 'member'
  if (role !== 'super_admin') {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-bold text-red-500">403 — Super admin only</h1>
        <p className="mt-2 text-muted-foreground">
          The webhook DLQ is only visible to super admins. Your role: <code>{role}</code>.
        </p>
      </div>
    )
  }

  // Service role read (bypasses RLS)
  const svc = createServiceClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  let q = svc
    .from('webhook_dlq')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(200)
  if (providerFilter) q = q.eq('provider', providerFilter)
  const { data: entries = [], error } = await q

  const counts: Record<string, number> = {}
  for (const e of (entries ?? []) as DlqEntry[]) {
    counts[e.provider] = (counts[e.provider] ?? 0) + 1
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Webhook DLQ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dead-letter queue for webhook deliveries that couldn&apos;t be routed.
            Most common causes: tenant metadata not yet enriched (Stripe account_id / Calendar channel_id),
            malformed payload, or bad signature.
          </p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <FilterChip href="/admin/webhook-dlq" active={!providerFilter}>
          All ({(entries ?? []).length})
        </FilterChip>
        {['stripe', 'gmail', 'calendar'].map(p => (
          <FilterChip
            key={p}
            href={`/admin/webhook-dlq?provider=${p}`}
            active={providerFilter === p}
          >
            {p} ({counts[p] ?? 0})
          </FilterChip>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500 bg-red-500/10 p-3 text-sm text-red-300">
          Query failed: {error.message}
        </div>
      )}

      {(entries ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card-bg p-12 text-center">
          <p className="text-muted-foreground">
            {providerFilter
              ? `No ${providerFilter} webhooks in the DLQ.`
              : 'Empty DLQ — every recent webhook routed successfully.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Received</th>
                <th className="px-3 py-2 font-semibold">Provider</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 font-semibold">Body (first 500 chars)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {((entries ?? []) as DlqEntry[]).map(e => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(e.received_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-medium">{e.provider}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
                      {e.reason}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    <details>
                      <summary className="cursor-pointer">{(e.body ?? '').slice(0, 80)}…</summary>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px]">
                        {e.body ?? '(empty)'}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Showing up to 200 most recent. To dig deeper, query <code>webhook_dlq</code> via Supabase
        SQL editor.
      </p>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={`rounded-full border px-3 py-1 transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border hover:bg-muted'
      }`}
    >
      {children}
    </a>
  )
}
