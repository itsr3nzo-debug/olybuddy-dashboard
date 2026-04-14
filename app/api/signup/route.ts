import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PLAN_PRICES } from '@/lib/stripe'
import { sendSystemEmail } from '@/lib/email'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Rate limiting via Supabase (works on serverless — no in-memory state)
const RATE_LIMIT = 3
const RATE_WINDOW_MINUTES = 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkRateLimit(ip: string, supabase: any): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
  // Count recent signups from this IP (using webhook_log as a lightweight rate limit table)
  const { count } = await supabase
    .from('webhook_log')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'signup_rate_limit')
    .eq('endpoint', ip)
    .gte('created_at', windowStart)
  return (count ?? 0) < RATE_LIMIT
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordSignupAttempt(ip: string, supabase: any) {
  await supabase.from('webhook_log').insert({
    source: 'signup_rate_limit',
    endpoint: ip,
    status_code: 200,
  })
}

const VALID_PLANS = ['trial', 'starter', 'pro', 'enterprise']
const VALID_INDUSTRIES = ['landscaper','electrician','plumber','builder','roofer','gardener','fencing','paving','decking','tree-surgeon','cleaner','dental','estate-agent','solicitor','recruitment','hair-salon','dog-groomer']

export async function POST(req: NextRequest) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Rate limiting (Supabase-backed — works on serverless)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'
  if (!(await checkRateLimit(ip, supabase))) {
    return NextResponse.json({ error: 'Too many signups. Please try again in a few minutes.' }, { status: 429 })
  }
  await recordSignupAttempt(ip, supabase)

  const body = await req.json()
  const { business_name, contact_name, email, phone, industry, services, location, plan, personality } = body

  // Input validation
  if (!business_name || !email || !industry || !plan) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }
  if (!VALID_INDUSTRIES.includes(industry)) {
    return NextResponse.json({ error: 'Invalid industry' }, { status: 400 })
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

  // Create client row
  const { data: client, error: clientErr } = await supabase.from('clients').insert({
    name: business_name,
    slug,
    email,
    phone: phone || null,
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
    agent_name: 'Ava',
    agent_status: 'offline',
    is_active: false,
    tone: personality || 'friendly',
    greeting_message: `Hey! I'm the AI assistant for ${business_name}. How can I help you today?`,
  })

  if (configErr) {
    console.error('[signup] Failed to create agent_config:', configErr)
    // Clean up the orphan client row
    await supabase.from('clients').delete().eq('id', clientId)
    return NextResponse.json({ error: 'Failed to set up your AI Employee. Please try again.' }, { status: 500 })
  }

  // TRIAL: create auth user and send magic link immediately
  if (plan === 'trial') {
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false,
      app_metadata: { client_id: clientId, role: 'owner' },
    })

    if (authErr) {
      return NextResponse.json({ error: 'Failed to create account. Please try again.' }, { status: 500 })
    }

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` },
    })

    if (linkErr || !linkData?.properties?.action_link) {
      return NextResponse.json({ error: 'Account created but failed to send login link. Try signing in at /login.' }, { status: 500 })
    }

    try {
      await sendSystemEmail({
        to: email,
        subject: 'Welcome to Nexley AI — Your AI Employee is ready',
        html: `<p>Hi ${contact_name || 'there'},</p>
          <p>Your 5-day trial is active! Click below to set up your AI Employee:</p>
          <p><a href="${linkData.properties.action_link}" style="background:#2563EB;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Access Your Dashboard</a></p>
          <p>Your trial runs until ${new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}.</p>
          <p>— The Nexley AI Team</p>`,
      })
    } catch {
      // Email failed but account exists — they can still use /login
    }

    return NextResponse.json({ success: true, trial: true })
  }

  // PAID: create Stripe Checkout session
  const priceId = PLAN_PRICES[plan]
  if (!priceId) {
    return NextResponse.json({ error: 'Invalid plan or Stripe not configured' }, { status: 400 })
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
