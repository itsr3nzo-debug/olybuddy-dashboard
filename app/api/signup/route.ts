import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PLAN_PRICES } from '@/lib/stripe'
import { sendSystemEmail } from '@/lib/email'

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

const VALID_PLANS = ['trial', 'employee', 'voice']

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
  if (typeof password !== 'string' || password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
  }
  if (!/\d/.test(password)) {
    return NextResponse.json({ error: 'Password must contain at least one number' }, { status: 400 })
  }
  if (password.length > 200) {
    return NextResponse.json({ error: 'Password too long' }, { status: 400 })
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
  const { data: client, error: clientErr } = await supabase.from('clients').insert({
    name: business_name,
    slug,
    email,
    phone: resolvedPhone,
    industry,
    contact_name: contact_name || null,
    location: location || null,
    services_text: services || null,
    subscription_status: plan === 'trial' ? 'trial' : 'pending_payment',
    subscription_plan: plan,
    trial_ends_at: plan === 'trial' ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() : null,
    onboarding_completed: false,
    onboarding_step: 0,
    vps_status: 'pending',
  }).select('id').single()

  if (clientErr || !client) {
    console.error('Failed to create client:', clientErr)
    return NextResponse.json({ error: clientErr?.message || 'Failed to create client' }, { status: 500 })
  }

  const clientId = client.id

  // Create agent_config with sensible defaults
  const agentApiKey = `oak_${Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')}`

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
    agent_api_key: agentApiKey,
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
      },
    })
  } catch (e) {
    console.error('[signup] failed to enqueue provisioning:', e)
  }

  // TRIAL: welcome email (no login link needed — they know their password)
  if (plan === 'trial') {
    try {
      await sendSystemEmail({
        to: email,
        subject: 'Welcome to Nexley AI — Your AI Employee is ready',
        html: `<p>Hi ${contact_name || 'there'},</p>
          <p>Your 5-day trial is active. Sign in with the password you just chose:</p>
          <p><a href="${process.env.NEXT_PUBLIC_SITE_URL!}/login" style="background:#2563EB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Sign in</a></p>
          <p>Your trial runs until ${new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}.</p>
          <p>— The Nexley AI Team</p>`,
      })
    } catch {
      // Email failed but account exists — they can still use /login
    }

    // Enroll in the 5-touch conversion sequence. Idempotent via PK on user_id.
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

    return NextResponse.json({ success: true, trial: true })
  }

  // PAID: create Stripe Checkout session
  const priceId = PLAN_PRICES[plan]
  if (!priceId || priceId.startsWith('price_PLACEHOLDER')) {
    return NextResponse.json({ error: 'This plan isn\'t available yet. Please start with the 5-day trial — we\'ll have paid plans live shortly.' }, { status: 400 })
  }

  const { getStripe } = await import('@/lib/stripe')
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    metadata: { client_id: clientId, plan, business_name },
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/signup?cancelled=true`,
  })

  return NextResponse.json({ success: true, checkoutUrl: session.url })
}
