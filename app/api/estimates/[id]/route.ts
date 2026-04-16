import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getClientId(req?: NextRequest): Promise<string | null> {
  // 1. Agent bearer key path (for on-VPS agents writing back take-off results)
  const auth = req?.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(oak_[a-f0-9]+)$/i)
  if (m) {
    const sb = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
    const { data } = await sb.from('agent_config').select('client_id').eq('agent_api_key', m[1]).maybeSingle()
    return data?.client_id ?? null
  }
  // 2. User cookie session path (for dashboard edits)
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) ?? null
}

// Pricing recomputation (kept in sync with /api/estimates POST).
// If this grows, extract to lib/pricing.ts.
type PricingRules = {
  labour_hourly_gbp: number
  markup_tiers: Record<string, number>
  loading_rules: Record<string, number>
  item_rates: Record<string, { material_gbp: number; labour_mins: number; tier: string }>
}

function computePricing(takeoff: Record<string, number>, rules: PricingRules) {
  const byItem: Array<Record<string, unknown>> = []
  let totalMaterial = 0
  let totalLabourMins = 0
  const assumptions: string[] = [
    'Cable-run metres NOT measured — add manually',
    `Labour rate £${rules.labour_hourly_gbp}/hr`,
  ]
  for (const [item, qty] of Object.entries(takeoff)) {
    if (typeof qty !== 'number' || qty <= 0) continue
    const rate = rules.item_rates[item]
    if (!rate) {
      assumptions.push(`Skipped ${item} (${qty}) — no rate set`)
      continue
    }
    const markupPct = rules.markup_tiers[rate.tier] ?? 25
    const materialCost = qty * rate.material_gbp * (1 + markupPct / 100)
    const labourMins = qty * rate.labour_mins
    totalMaterial += materialCost
    totalLabourMins += labourMins
    byItem.push({
      item, qty, unit_material_gbp: rate.material_gbp, markup_pct: markupPct,
      line_material_gbp: Math.round(materialCost * 100) / 100,
      labour_mins: labourMins,
      line_labour_gbp: Math.round((labourMins / 60) * rules.labour_hourly_gbp * 100) / 100,
      tier: rate.tier,
    })
  }
  const labourHours = Math.round((totalLabourMins / 60) * 100) / 100
  const labourCost = Math.round((totalLabourMins / 60) * rules.labour_hourly_gbp * 100) / 100
  const subtotal = Math.round((totalMaterial + labourCost) * 100) / 100
  const loadingPct = Object.values(rules.loading_rules ?? {}).reduce((a, b) => a + Number(b), 0)
  const loadingGbp = Math.round((subtotal * loadingPct / 100) * 100) / 100
  const total = Math.round((subtotal + loadingGbp) * 100) / 100
  return {
    by_item: byItem,
    totals: {
      materials_gbp: Math.round(totalMaterial * 100) / 100,
      labour_hours: labourHours, labour_gbp: labourCost,
      subtotal_gbp: subtotal, loading_pct: loadingPct, loading_gbp: loadingGbp, total_gbp: total,
    },
    assumptions,
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const clientId = await getClientId(req)
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const supabase = service()

  const update: Record<string, unknown> = {}
  for (const k of ['title', 'status', 'takeoff_json', 'takeoff_review_notes', 'actual_materials_gbp', 'actual_labour_hours', 'actual_total_gbp']) {
    if (k in body) update[k] = body[k]
  }
  if (body.status === 'sent_to_client') update.sent_to_client_at = new Date().toISOString()
  if (['won', 'lost', 'withdrawn'].includes(body.status)) update.outcome_at = new Date().toISOString()

  // Recompute pricing if take-off changed or caller requested
  if (body.recompute_pricing || 'takeoff_json' in body) {
    const { data: rulesRow } = await supabase.from('pricing_rules').select('*').eq('client_id', clientId).maybeSingle()
    const rules: PricingRules = rulesRow
      ? {
          labour_hourly_gbp: rulesRow.labour_hourly_gbp,
          markup_tiers: rulesRow.markup_tiers,
          loading_rules: rulesRow.loading_rules,
          item_rates: rulesRow.item_rates,
        }
      : {
          labour_hourly_gbp: 65,
          markup_tiers: { standard: 25, specialist: 40, heritage: 50 },
          loading_rules: {},
          item_rates: {},
        }
    const takeoff = (body.takeoff_json as Record<string, number>) ?? {}
    // Need current row's takeoff if not sent
    const currentTakeoff = body.takeoff_json
      ? takeoff
      : ((await supabase.from('estimates').select('takeoff_json').eq('id', id).eq('client_id', clientId).maybeSingle()).data?.takeoff_json ?? {})
    const pricing = computePricing(currentTakeoff as Record<string, number>, rules)
    update.pricing_json = pricing
    update.estimated_total_gbp = pricing.totals.total_gbp
  }

  // Compute margin delta if actuals supplied
  if (body.actual_total_gbp != null) {
    const { data: cur } = await supabase.from('estimates')
      .select('estimated_total_gbp, pricing_json, actual_materials_gbp, actual_labour_hours')
      .eq('id', id).eq('client_id', clientId).maybeSingle()
    if (cur?.estimated_total_gbp) {
      const actualMargin = Number(body.actual_total_gbp)
        - Number(body.actual_materials_gbp ?? cur.actual_materials_gbp ?? 0)
      const expectedMargin = Number(cur.estimated_total_gbp)
        - Number((cur.pricing_json as { totals?: { materials_gbp?: number } })?.totals?.materials_gbp ?? 0)
      update.actual_margin_gbp = Math.round(actualMargin * 100) / 100
      update.margin_delta_pct = expectedMargin !== 0
        ? Math.round(((actualMargin - expectedMargin) / expectedMargin) * 10000) / 100
        : 0
    }
  }

  const { data, error } = await supabase
    .from('estimates').update(update).eq('id', id).eq('client_id', clientId).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, estimate: data })
}
