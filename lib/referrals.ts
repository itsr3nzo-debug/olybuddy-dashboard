/**
 * Referral program (#14) — shared logic.
 *
 * Terms (set by Renzo):
 *   - Each successful referral = £150 off the referrer's next monthly
 *     invoice.
 *   - "Successful" = the referee's Stripe subscription transitioned
 *     trialing → active at least once (first £599 invoice paid).
 *   - 4 successful referrals in a billing month = ~free month
 *     (4 × £150 = £600 ≈ £599 monthly).
 *   - Credit is applied via Stripe customer balance (negative integer
 *     pence). Stripe auto-deducts on the next invoice.
 *
 * Public surface used by:
 *   - /api/referrals/me        → dashboard widget
 *   - /api/webhook/stripe      → fires creditReferral() on first paid invoice
 *   - /api/signup/route.ts     → calls attributeReferral() if the URL had ?ref=
 */
import { createClient } from '@supabase/supabase-js'

export const REFERRAL_CREDIT_PENCE = 15000  // £150.00

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function svc() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

/**
 * Look up a clients row by its referral_code. Returns null if not found
 * (silently ignored — invalid ref codes don't block signup).
 */
export async function findReferrer(code: string): Promise<{ id: string; name: string | null } | null> {
  if (!code) return null
  const normalized = code.trim().toLowerCase()
  if (normalized.length < 4 || normalized.length > 60) return null
  const { data } = await svc()
    .from('clients')
    .select('id, name')
    .eq('referral_code', normalized)
    .maybeSingle()
  return data || null
}

/**
 * On signup: attribute the new client to a referrer. Idempotent — if the
 * UNIQUE constraint on referee fires, we just return null (referee was
 * already attributed, e.g. they signed up twice with different refs).
 *
 * Self-referral guard: if the referrer === referee, we silently skip.
 */
export async function attributeReferral(opts: {
  refereeClientId: string
  refereeEmail: string
  referrerCode: string | null | undefined
}): Promise<{ ok: boolean; referralId?: string; reason?: string }> {
  if (!opts.referrerCode) return { ok: false, reason: 'no_code' }

  const referrer = await findReferrer(opts.referrerCode)
  if (!referrer) return { ok: false, reason: 'invalid_code' }
  if (referrer.id === opts.refereeClientId) return { ok: false, reason: 'self_referral' }

  // Set referred_by_client_id on the referee's clients row for audit.
  await svc()
    .from('clients')
    .update({ referred_by_client_id: referrer.id })
    .eq('id', opts.refereeClientId)

  // Insert pending referral. UNIQUE (referee_client_id) gives idempotency.
  const { data, error } = await svc()
    .from('referrals')
    .insert({
      referrer_client_id: referrer.id,
      referee_client_id: opts.refereeClientId,
      status: 'pending',
      credit_amount_pence: REFERRAL_CREDIT_PENCE,
      meta: { referee_email: opts.refereeEmail },
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'already_attributed' }
    return { ok: false, reason: error.message }
  }
  return { ok: true, referralId: data?.id }
}

/**
 * Called by the Stripe webhook on the first successful £599 invoice for a
 * referee. Marks the referral 'qualified', applies a £150 credit to the
 * referrer's Stripe customer balance, and marks 'credited'. Idempotent —
 * checks current status before each transition.
 */
export async function creditReferralForReferee(opts: {
  refereeClientId: string
  /** Stripe SDK instance from getStripe() */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stripe: any
}): Promise<{ ok: boolean; reason?: string; credited?: boolean }> {
  const supabase = svc()

  // Find the referral. If none, this referee wasn't referred — fine.
  const { data: referral } = await supabase
    .from('referrals')
    .select('id, referrer_client_id, status, credit_amount_pence')
    .eq('referee_client_id', opts.refereeClientId)
    .maybeSingle()

  if (!referral) return { ok: false, reason: 'no_referral' }
  if (referral.status === 'credited') return { ok: true, reason: 'already_credited' }
  if (referral.status === 'reversed') return { ok: false, reason: 'reversed' }

  // Need referrer's stripe_customer_id to apply the credit.
  const { data: referrer } = await supabase
    .from('clients')
    .select('id, stripe_customer_id, name, email')
    .eq('id', referral.referrer_client_id)
    .maybeSingle()

  if (!referrer || !referrer.stripe_customer_id) {
    return { ok: false, reason: 'referrer_no_stripe_customer' }
  }

  // Apply credit via Stripe customer balance — negative = credit.
  let txnId: string | null = null
  try {
    const txn = await opts.stripe.customers.createBalanceTransaction(
      referrer.stripe_customer_id,
      {
        amount: -Math.abs(referral.credit_amount_pence),
        currency: 'gbp',
        description: `Nexley AI referral credit \u2014 thanks for referring a new customer`,
        metadata: {
          referral_id: referral.id,
          referee_client_id: opts.refereeClientId,
          referrer_client_id: referrer.id,
        },
      },
      { idempotencyKey: `referral-credit-${referral.id}` }
    )
    txnId = txn?.id ?? null
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'stripe_credit_failed' }
  }

  // Mark referral credited.
  await supabase
    .from('referrals')
    .update({
      status: 'credited',
      qualified_at: new Date().toISOString(),
      credited_at: new Date().toISOString(),
      stripe_balance_txn_id: txnId,
    })
    .eq('id', referral.id)

  return { ok: true, credited: true }
}

export interface ReferralStats {
  code: string | null
  shareUrl: string
  count: {
    total: number
    pending: number
    credited: number
  }
  totalSavedPence: number
  /** Until you hit 4 (a free month), how many more do you need? */
  toNextFreeMonth: number
}

/** Reads referral stats for a single client — drives the dashboard widget. */
export async function getReferralStats(clientId: string, siteUrl: string): Promise<ReferralStats> {
  const supabase = svc()
  const { data: client } = await supabase
    .from('clients')
    .select('referral_code')
    .eq('id', clientId)
    .maybeSingle()

  const { data: referrals } = await supabase
    .from('referrals')
    .select('status, credit_amount_pence')
    .eq('referrer_client_id', clientId)

  const pending = (referrals || []).filter(r => r.status === 'pending').length
  const credited = (referrals || []).filter(r => r.status === 'credited').length
  const total = (referrals || []).length
  const totalSavedPence = (referrals || [])
    .filter(r => r.status === 'credited')
    .reduce((s, r) => s + (r.credit_amount_pence || 0), 0)

  const code = client?.referral_code ?? null
  return {
    code,
    shareUrl: code ? `${siteUrl}/signup?ref=${code}` : '',
    count: { total, pending, credited },
    totalSavedPence,
    toNextFreeMonth: Math.max(0, 4 - credited),
  }
}
