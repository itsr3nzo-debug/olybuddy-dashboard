import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validatePassword } from '@/lib/password-policy'
import { sendVerificationEmail } from '@/lib/auth/email-verification'
import { hashAgentKey } from '@/lib/agent-auth'
import { attributeReferral } from '@/lib/referrals'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Rate limiting via Supabase (works on serverless — no in-memory state)
// 10 attempts per 15 min window per IP.
const RATE_LIMIT = 10
const RATE_WINDOW_MINUTES = 15

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkRateLimit(ip: string, supabase: any): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .eq('key', `signup:${ip}`)
    .gte('created_at', windowStart)
  return (count ?? 0) < RATE_LIMIT
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordSignupAttempt(ip: string, supabase: any) {
  await supabase.from('rate_limit_events').insert({ key: `signup:${ip}` })
}

// 'trial'      — £19.99 5-day trial → £599/mo (the standard onboarding flow)
// 'pro'        — £599/mo standalone (skips the trial; bills monthly straight away)
// 'enterprise' — £2,995/mo for teams of 10+ (multi-seat, custom contracts)
// 'employee', 'voice' — legacy plan IDs kept for backward compatibility with
//                       any in-flight Stripe sessions that haven't completed.
const VALID_PLANS = ['trial', 'pro', 'enterprise', 'employee', 'voice']

// UK mobile normalization — accepts 07xxx, +447xxx, 447xxx, returns 447xxx or null.
function normalizeUkPhone(input: string | undefined | null): string | null {
  if (!input) return null
  const digits = String(input).replace(/[^\d+]/g, '')
  if (/^\+447\d{9}$/.test(digits)) return digits.slice(1)
  if (/^447\d{9}$/.test(digits)) return digits
  if (/^07\d{9}$/.test(digits)) return '44' + digits.slice(1)
  return null
}
// Industry is a user-chosen string — not from a closed enum. We only guard
// against empty/oversized input. The provisioning step falls back to a
// generic template if the industry has no specific Layer 2 file.

export async function POST(req: NextRequest) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Rate limiting (Supabase-backed — works on serverless)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!(await checkRateLimit(ip, supabase))) {
    return NextResponse.json({ error: 'Too many signups. Please try again in a few minutes.' }, { status: 429 })
  }
  await recordSignupAttempt(ip, supabase)

  const body = await req.json()
  const {
    business_name, contact_name, email, password, phone, industry, services, location, plan, personality,
    business_whatsapp, owner_phone, owner_name, agent_name,
    // Item #14 — referral code from ?ref= URL param, forwarded by signup wizard.
    referral_code,
  } = body

  // AI employee display name. Trim + cap at 30 chars (UI also caps at 30).
  // Fallback to "Nexley" if omitted or empty (brand default + matches provision-ai-employee.py).
  const sanitizedAgentName = (typeof agent_name === 'string' && agent_name.trim())
    ? agent_name.trim().slice(0, 30)
    : 'Nexley'

  // Input validation
  if (!business_name || !email || !password || !industry || !plan) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Sender Role Protocol: both the agent's WhatsApp number and the owner's personal
  // WhatsApp number are REQUIRED. Without both, the agent can't distinguish
  // owner-commands from customer-enquiries.
  const normalizedBusinessWa = normalizeUkPhone(business_whatsapp)
  const normalizedOwnerPhone = normalizeUkPhone(owner_phone)
  if (!normalizedBusinessWa) {
    return NextResponse.json({ error: 'Business WhatsApp number must be a valid UK mobile' }, { status: 400 })
  }
  if (!normalizedOwnerPhone) {
    return NextResponse.json({ error: 'Your personal WhatsApp number must be a valid UK mobile' }, { status: 400 })
  }
  if (normalizedBusinessWa === normalizedOwnerPhone) {
    return NextResponse.json({ error: 'Business and personal WhatsApp must be different numbers' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Password must be a string' }, { status: 400 })
  }
  // Shared policy — same rules the live UI checklist enforces. Keeps the
  // server as the source of truth so a hand-crafted POST can't bypass the
  // strength rules by skipping the wizard.
  const pwCheck = validatePassword(password, { email, businessName: business_name })
  if (pwCheck.error) {
    return NextResponse.json({ error: pwCheck.error }, { status: 400 })
  }
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }
  if (typeof industry !== 'string' || industry.length === 0 || industry.length > 60) {
    return NextResponse.json({ error: 'Industry must be a short label (1–60 chars)' }, { status: 400 })
  }
  if (typeof business_name !== 'string' || business_name.length > 200) {
    return NextResponse.json({ error: 'Business name too long' }, { status: 400 })
  }

  // Check if email already has an account
  const { data: existingClient } = await supabase.from('clients').select('id').eq('email', email).single()
  if (existingClient) {
    return NextResponse.json({ error: 'An account with this email already exists. Try signing in instead.' }, { status: 409 })
  }

  // Generate unique slug (handle collision with suffix)
  let slug = business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const { data: existingSlugs } = await supabase.from('clients').select('slug').like('slug', `${slug}%`)
  if (existingSlugs?.length) {
    const taken = new Set(existingSlugs.map(r => r.slug))
    if (taken.has(slug)) {
      let i = 2
      while (taken.has(`${slug}-${i}`)) i++
      slug = `${slug}-${i}`
    }
  }

  // Create client row. Prefer the explicit `phone` field; fall back to the
  // business WhatsApp number the user just entered so the contact details
  // page is pre-populated instead of showing a blank placeholder.
  const resolvedPhone = (phone && String(phone).trim()) || normalizedBusinessWa || normalizedOwnerPhone || null

  // Item #14 — generate a referral code now so the new client can share
  // immediately. Format mirrors the migration backfill: <6 of slug>-<4 hex>.
  // 16^4 = 65k random suffix per slug-prefix is plenty for collision avoidance
  // and keeps the URL short.
  const buildReferralCode = (slugStr: string) => {
    const prefix = slugStr.slice(0, 6).replace(/[^a-z0-9]/g, '')
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(2)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    return `${prefix}-${suffix}`
  }

  // Helper — we may need to retry with a different slug on collision, so keep
  // the insert payload in a reusable closure.
  const insertClient = async (slugToUse: string) =>
    supabase.from('clients').insert({
      name: business_name,
      slug: slugToUse,
      email,
      phone: resolvedPhone,
      industry,
      contact_name: contact_name || null,
      location: location || null,
      services_text: services || null,
      referral_code: buildReferralCode(slugToUse),
      // Every signup now goes through Stripe Checkout BEFORE becoming a real
      // 'trial'. Until the checkout.session.completed webhook fires and sets
      // stripe_customer_id + stripe_subscription_id, the client row stays in
      // 'pending_payment' — this prevents:
      //   (a) trial-expiry cron from emailing "your trial has ended" to people
      //       who never actually paid (filter matches only status='trial')
      //   (b) provision-poller from spinning up a VPS before payment clears
      //       (filter requires status IN ('trial','active'))
      //   (c) the billing page rendering a stale "you're on a 5-day trial"
      //       CTA for someone who abandoned checkout
      subscription_status: 'pending_payment',
      subscription_plan: plan,
      // Webhook sets trial_ends_at from sub.trial_end — don't guess here; a
      // signup-time value would drift if webhook delivery is delayed a few
      // minutes (and this is what's bitten us before).
      trial_ends_at: null,
      onboarding_completed: false,
      onboarding_step: 0,
      vps_status: 'pending',
    }).select('id').single()

  let { data: client, error: clientErr } = await insertClient(slug)

  if (clientErr || !client) {
    // Translate UNIQUE-violation races (email collision, slug collision) into
    // user-friendly errors instead of a raw 500. Postgres code 23505 =
    // unique_violation. The constraint name tells us WHICH one lost the race:
    //   clients_email_unique    → duplicate email
    //   clients_slug_key        → duplicate slug (another business with same name)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = clientErr as any
    const msg = String(err?.message || '')
    const details = String(err?.details || '')
    if (err?.code === '23505') {
      if (msg.includes('email') || details.includes('email')) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Try signing in instead.' },
          { status: 409 }
        )
      }
      if (msg.includes('slug') || details.includes('slug')) {
        // Slug collision race — the TOCTOU on our in-app slug uniqueness
        // check lost. Retry once with a random 4-char suffix.
        const retry = await insertClient(`${slug}-${Math.random().toString(36).slice(2, 6)}`)
        if (retry.error || !retry.data) {
          console.error('Failed to create client (slug retry):', retry.error)
          return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 })
        }
        client = retry.data
        clientErr = null
      } else {
        return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 })
      }
    } else {
      console.error('Failed to create client:', clientErr)
      return NextResponse.json({ error: clientErr?.message || 'Failed to create client' }, { status: 500 })
    }
  }

  // After all the conditional retries, TypeScript can't narrow `client` to non-null.
  if (!client) {
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }

  const clientId = client.id

  // Create agent_config with sensible defaults. The raw key is generated
  // once here, never stored in plaintext on the dashboard side — only the
  // SHA-256 hash goes into agent_config (item #4). The raw key is forwarded
  // to provisioning_queue.meta so the worker can push it to the VPS .env
  // file; the worker deletes the row after applying.
  const agentApiKey = `oak_${Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')}`
  const agentApiKeyHash = hashAgentKey(agentApiKey)

  const { error: configErr } = await supabase.from('agent_config').insert({
    client_id: clientId,
    business_name,
    business_description: `${industry.replace(/-/g, ' ')} in ${location || 'UK'}`,
    services: services ? services.split(',').map((s: string) => ({ name: s.trim(), description: '' })) : [],
    hours: {
      mon: { open: '09:00', close: '17:00' },
      tue: { open: '09:00', close: '17:00' },
      wed: { open: '09:00', close: '17:00' },
      thu: { open: '09:00', close: '17:00' },
      fri: { open: '09:00', close: '17:00' },
      sat: 'closed',
      sun: 'closed',
    },
    sms_enabled: true,
    whatsapp_enabled: true,
    model_preference: 'auto',
    // Hash-only — raw key goes to provisioning_queue.meta below.
    agent_api_key_hash: agentApiKeyHash,
    agent_name: sanitizedAgentName,
    agent_status: 'offline',
    is_active: false,
    tone: personality || 'optimistic',
    greeting_message: `Hey, I'm ${sanitizedAgentName} — an assistant at ${business_name}. How can I help?`,
    business_whatsapp: normalizedBusinessWa,
    owner_phone: normalizedOwnerPhone,
    owner_name: (typeof owner_name === 'string' && owner_name.trim()) || contact_name || null,
    owner_aliases: [],
  })

  if (configErr) {
    console.error('[signup] Failed to create agent_config:', configErr)
    // Rollback: delete orphan client row (auth user not created yet at this point)
    await supabase.from('clients').delete().eq('id', clientId)
    return NextResponse.json({ error: 'Failed to set up your AI Employee. Please try again.' }, { status: 500 })
  }

  // Create Supabase auth user with the password UPFRONT (works for both trial
  // and paid flows). For paid: user can log in immediately; dashboard shows
  // "payment pending" banner until the Stripe webhook flips subscription_status.
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no email verification step — they chose their password so we trust them
    // onboarding_completed is stamped on the JWT so the proxy can gate /dashboard
    // vs /onboarding with zero DB hits on the hot path. Flipped to true by the
    // PATCH /api/onboarding step 4 handler when the user finishes onboarding.
    app_metadata: { client_id: clientId, role: 'owner', onboarding_completed: false },
  })

  if (authErr) {
    // Rollback: remove client + agent_config so the user can retry with the same email
    console.error('[signup] Failed to create auth user:', authErr.message)
    await supabase.from('agent_config').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    return NextResponse.json({ error: authErr.message || 'Failed to create account.' }, { status: 500 })
  }

  // Enqueue a provisioning run so the new client's VPS (once spun up by the
  // provisioning worker) gets access.json + CLAUDE.md with the correct owner
  // numbers baked in. Best-effort.
  try {
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'full_reprovision',
      triggered_by: 'signup',
      meta: {
        owner_phone: normalizedOwnerPhone,
        business_whatsapp: normalizedBusinessWa,
        plan,
        // Raw oak_ key for the worker to write to /opt/clients/{slug}/.env.
        // Worker deletes this row after applying so the raw key isn't
        // retained on the dashboard side. Item #4 (hash-at-rest).
        agent_api_key: agentApiKey,
      },
    })
  } catch (e) {
    console.error('[signup] failed to enqueue provisioning:', e)
  }

  // Enrol in the trial-sequence email drip (Day 1/3/4/5 nudges + winback).
  // Idempotent via PK on user_id.
  if (authData?.user?.id) {
    try {
      await supabase.from('trial_sequence').insert({
        user_id: authData.user.id,
        client_id: clientId,
        signed_up_at: new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[signup] trial_sequence enrol failed', e)
    }
  }

  // Send the email-verification link. Best-effort — a bounce or SMTP outage
  // shouldn't fail signup, the dashboard banner gives them a "Resend" CTA
  // (POST /api/auth/resend-verification, rate-limited to 3/hr/account).
  // We DELIBERATELY don't await rate-limiting on the first send — every
  // signup gets exactly one welcome verification regardless.
  try {
    await sendVerificationEmail({ clientId, email, businessName: business_name })
  } catch (e) {
    console.warn('[signup] verification email failed (non-fatal):', e)
  }

  // Item #14 — attribute referral if ?ref= came through. Silently swallows
  // invalid codes / self-referrals — the user shouldn't see an error if
  // someone gave them a malformed URL. The referral stays 'pending' until
  // their first £599 invoice clears, then the Stripe webhook flips it to
  // 'credited' and applies the £150 credit to the referrer's balance.
  if (referral_code) {
    try {
      const result = await attributeReferral({
        refereeClientId: clientId,
        refereeEmail: email,
        referrerCode: String(referral_code),
      })
      if (!result.ok) {
        console.log('[signup] referral attribution skipped:', result.reason, 'code:', referral_code)
      }
    } catch (e) {
      console.warn('[signup] referral attribution failed (non-fatal):', e)
    }
  }

  // UNIFIED CHECKOUT FLOW (same for every plan):
  //   1. Charge £20 onboarding fee now (mode=payment) — covers the 5-day trial.
  //   2. Save the card (setup_future_usage='off_session') so we can auto-bill later.
  //   3. Stripe webhook checkout.session.completed creates a Subscription on the
  //      same customer with trial_period_days=5 + £599/mo price. The first
  //      subscription invoice fires on Day 6.
  //
  // This matches the owner-stated flow: "£20 onboarding for 5-day trial, then
  // £599/mo" — they pay once at signup, then Stripe auto-bills £599 on Day 6
  // unless they cancel in the dashboard during the trial.
  const trialPriceId = process.env.STRIPE_PRICE_TRIAL
  const subscriptionPriceId = process.env.STRIPE_PRICE_EMPLOYEE
  if (!trialPriceId || !subscriptionPriceId || trialPriceId.startsWith('price_PLACEHOLDER') || subscriptionPriceId.startsWith('price_PLACEHOLDER')) {
    // Env not configured — do not silently drop the customer. Rollback the
    // Supabase rows so they can retry after we set the prices.
    console.error('[signup] Stripe price env vars missing or placeholder')
    await supabase.from('agent_config').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    if (authData?.user?.id) {
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {})
    }
    return NextResponse.json({ error: 'Checkout is temporarily unavailable. Please try again in a few minutes.' }, { status: 503 })
  }

  // Wrap the Checkout Session creation in try/catch. If Stripe has an outage
  // or the network fails, we'd otherwise leave an orphan Supabase row with no
  // way for the customer to complete payment — they'd have to use a different
  // email to retry. Rolling back keeps things clean.
  try {
    const { getStripe } = await import('@/lib/stripe')
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      customer_creation: 'always',
      metadata: {
        client_id: clientId,
        plan,
        business_name,
        // Used by the webhook to create the subscription on completion.
        create_subscription_price: subscriptionPriceId,
        subscription_trial_days: '5',
        user_id: authData?.user?.id ?? '',
      },
      line_items: [{ price: trialPriceId, quantity: 1 }],
      payment_intent_data: {
        // Keeps the card on file so we can auto-bill £599 on Day 6 off-session.
        setup_future_usage: 'off_session',
        metadata: { client_id: clientId, purpose: 'onboarding_fee' },
      },
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/signup?cancelled=true`,
    })

    return NextResponse.json({ success: true, checkoutUrl: session.url })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (stripeErr: any) {
    console.error('[signup] Stripe Checkout create failed:', stripeErr?.message)
    // Roll back so they can retry with the same email
    await supabase.from('agent_config').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    if (authData?.user?.id) {
      await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {})
    }
    return NextResponse.json(
      { error: 'Payment provider unavailable — please try again in a moment.' },
      { status: 503 }
    )
  }
}
