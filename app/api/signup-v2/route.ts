/**
 * Signup v2 — accepts business_whatsapp + owner_phone on top of the existing
 * signup payload. Backward compatible: if those two fields are missing, behaves
 * like the original /api/signup route.
 *
 * Frontend signup page should POST to /api/signup-v2 once the two new fields
 * are added to the UI. Until then, /api/signup keeps working untouched.
 *
 * This file does NOT modify or read the existing /api/signup code. It is a
 * clean implementation designed to eventually replace /api/signup.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ---------- Validation ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_RE = /^(?=.*\d).{10,}$/
const UK_PHONE_RE = /^(\+?44|0)7\d{9}$/

function normalizeUkPhone(input: string | undefined | null): string | null {
  if (!input) return null
  const digits = input.replace(/[^\d+]/g, '')
  // Accept: +447..., 447..., 07...
  if (/^\+447\d{9}$/.test(digits)) return digits.slice(1) // strip +
  if (/^447\d{9}$/.test(digits)) return digits
  if (/^07\d{9}$/.test(digits)) return '44' + digits.slice(1)
  return null
}

type SignupPayload = {
  email: string
  password: string
  business_name: string
  contact_name?: string
  phone?: string                   // legacy free-form phone (kept for compat)
  business_whatsapp?: string        // eSIM number the agent lives on
  owner_phone?: string              // owner's personal WhatsApp
  owner_name?: string               // display name for owner
  location?: string
  industry: string
  services?: string
  personality?: string
  plan?: string
}

// ---------- Rate limit (Supabase-backed, same pattern as existing signup) ----------

async function checkRateLimit(supabase: ReturnType<typeof createClient>, ip: string): Promise<{ allowed: boolean }> {
  const windowMin = 15
  const max = 10
  const since = new Date(Date.now() - windowMin * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('rate_limit_events')
    .select('id')
    .eq('key', `signup:${ip}`)
    .gte('created_at', since)
  if ((data?.length ?? 0) >= max) return { allowed: false }
  await supabase.from('rate_limit_events').insert({ key: `signup:${ip}` })
  return { allowed: true }
}

// ---------- Handler ----------

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit(supabase, ip)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many signup attempts. Try again in 15 minutes.' }, { status: 429 })
  }

  let body: SignupPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ---- Basic validation ----
  if (!body.email || !EMAIL_RE.test(body.email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }
  if (!body.password || !PASSWORD_RE.test(body.password)) {
    return NextResponse.json({ error: 'Password must be 10+ characters and include a number' }, { status: 400 })
  }
  if (!body.business_name || body.business_name.trim().length < 2) {
    return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
  }
  if (!body.industry || body.industry.trim().length === 0) {
    return NextResponse.json({ error: 'Industry is required' }, { status: 400 })
  }

  // ---- New fields: normalise + validate ----
  const businessWA = normalizeUkPhone(body.business_whatsapp)
  const ownerPhone = normalizeUkPhone(body.owner_phone)

  // If either number provided, both must be valid
  if (body.business_whatsapp && !businessWA) {
    return NextResponse.json({ error: 'Business WhatsApp number must be a valid UK mobile (e.g. 07xxx xxx xxx)' }, { status: 400 })
  }
  if (body.owner_phone && !ownerPhone) {
    return NextResponse.json({ error: 'Your personal WhatsApp number must be a valid UK mobile' }, { status: 400 })
  }
  // Enforce they're different
  if (businessWA && ownerPhone && businessWA === ownerPhone) {
    return NextResponse.json({
      error: 'Your business WhatsApp (eSIM) and personal WhatsApp must be different numbers. The agent pairs to the eSIM — you message it from your personal number.',
    }, { status: 400 })
  }

  const email = body.email.trim().toLowerCase()

  // ---- Duplicate check ----
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists. Try logging in.' }, { status: 409 })
  }

  // ---- Create client row ----
  const slug = body.business_name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `client-${Date.now()}`

  let finalSlug = slug
  let suffix = 2
  while (true) {
    const { data: taken } = await supabase.from('clients').select('id').eq('slug', finalSlug).maybeSingle()
    if (!taken) break
    finalSlug = `${slug}-${suffix++}`
    if (suffix > 20) finalSlug = `${slug}-${Date.now().toString(36)}`
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .insert({
      name: body.business_name.trim(),
      slug: finalSlug,
      email,
      phone: body.phone || businessWA || null,
      contact_name: body.contact_name?.trim() || null,
      industry: body.industry.trim(),
      services: body.services?.trim() || null,
      location: body.location?.trim() || null,
      subscription_status: 'trial',
      subscription_plan: body.plan || 'trial',
      trial_ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      vps_status: 'pending',
    })
    .select()
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Failed to create account. Please try again.', detail: clientErr?.message }, { status: 500 })
  }

  // ---- Create agent_config with NEW owner/business fields ----
  const agentApiKey = 'oak_' + crypto.randomBytes(24).toString('hex')

  const { error: configErr } = await supabase.from('agent_config').insert({
    client_id: client.id,
    business_name: body.business_name.trim(),
    tone: body.personality || 'optimistic',
    agent_api_key: agentApiKey,
    greeting_message: `Hi! I'm the AI assistant for ${body.business_name.trim()}. How can I help?`,
    owner_phone: ownerPhone,
    owner_name: body.owner_name?.trim() || body.contact_name?.trim() || null,
    business_whatsapp: businessWA,
    owner_aliases: [],
  })

  if (configErr) {
    // Rollback client row so user can retry with same email
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({ error: 'Failed to provision AI Employee. Please try again.', detail: configErr.message }, { status: 500 })
  }

  // ---- Create auth user ----
  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    app_metadata: {
      client_id: client.id,
      role: 'owner',
    },
    user_metadata: {
      business_name: body.business_name.trim(),
      contact_name: body.contact_name?.trim() || null,
    },
  })

  if (authErr || !authUser) {
    // Rollback client + agent_config
    await supabase.from('agent_config').delete().eq('client_id', client.id)
    await supabase.from('clients').delete().eq('id', client.id)
    return NextResponse.json({
      error: 'Failed to create login. Please try again.',
      detail: authErr?.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    trial: true,
    client_id: client.id,
    slug: finalSlug,
  })
}
