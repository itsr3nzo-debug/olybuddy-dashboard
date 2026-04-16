/**
 * /api/settings/sender-roles
 *
 * GET  — return owner_phone, owner_name, business_whatsapp, owner_aliases
 * PATCH — update any of the above
 *
 * Scoped to the authenticated user's client_id (from JWT app_metadata).
 * Uses service-role key for the actual write (bypasses RLS) but ALWAYS
 * constrains every query with .eq('client_id', user.app_metadata.client_id).
 *
 * This is a NEW standalone endpoint — it does not modify any existing route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

const UK_PHONE_RE = /^(\+?44|0)7\d{9}$/

function normalizeUkPhone(input: string | undefined | null): string | null {
  if (!input) return null
  const digits = input.replace(/[^\d+]/g, '')
  if (/^\+447\d{9}$/.test(digits)) return digits.slice(1)
  if (/^447\d{9}$/.test(digits)) return digits
  if (/^07\d{9}$/.test(digits)) return '44' + digits.slice(1)
  return null
}

async function getAuthedClientId(): Promise<{ clientId: string | null; role: string | null }> {
  const cookieStore = await cookies()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {
        // no-op — read-only in API route
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { clientId: null, role: null }

  const clientId = (user.app_metadata?.client_id as string | undefined) || null
  const role = (user.app_metadata?.role as string | undefined) || 'owner'
  return { clientId, role }
}

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ─────────────────── GET ───────────────────

export async function GET() {
  const { clientId } = await getAuthedClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = service()
  const { data, error } = await supabase
    .from('agent_config')
    .select('owner_phone, owner_name, business_whatsapp, owner_aliases')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to load settings', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({
    owner_phone: data?.owner_phone || '',
    owner_name: data?.owner_name || '',
    business_whatsapp: data?.business_whatsapp || '',
    owner_aliases: data?.owner_aliases || [],
  })
}

// ─────────────────── PATCH ───────────────────

type PatchPayload = {
  owner_phone?: string
  owner_name?: string
  business_whatsapp?: string
  owner_aliases?: string[]
}

export async function PATCH(req: NextRequest) {
  const { clientId, role } = await getAuthedClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only owner/super_admin can change sender roles. Member = read-only.
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can change sender roles' }, { status: 403 })
  }

  let body: PatchPayload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  // Owner phone
  if (body.owner_phone !== undefined) {
    if (body.owner_phone === '') {
      updates.owner_phone = null
    } else {
      const n = normalizeUkPhone(body.owner_phone)
      if (!n) {
        return NextResponse.json({ error: 'Owner phone must be a valid UK mobile' }, { status: 400 })
      }
      updates.owner_phone = n
    }
  }

  // Business WhatsApp
  if (body.business_whatsapp !== undefined) {
    if (body.business_whatsapp === '') {
      updates.business_whatsapp = null
    } else {
      const n = normalizeUkPhone(body.business_whatsapp)
      if (!n) {
        return NextResponse.json({ error: 'Business WhatsApp must be a valid UK mobile' }, { status: 400 })
      }
      updates.business_whatsapp = n
    }
  }

  // Owner name
  if (body.owner_name !== undefined) {
    const trimmed = body.owner_name.trim().slice(0, 60)
    updates.owner_name = trimmed || null
  }

  // Owner aliases (additional owner-level numbers)
  if (body.owner_aliases !== undefined) {
    if (!Array.isArray(body.owner_aliases)) {
      return NextResponse.json({ error: 'owner_aliases must be an array' }, { status: 400 })
    }
    const cleaned: string[] = []
    for (const raw of body.owner_aliases) {
      if (typeof raw !== 'string') continue
      const n = normalizeUkPhone(raw)
      if (!n) {
        return NextResponse.json({
          error: `Alias "${raw}" is not a valid UK mobile`,
        }, { status: 400 })
      }
      if (!cleaned.includes(n)) cleaned.push(n)
    }
    if (cleaned.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 owner-level numbers' }, { status: 400 })
    }
    updates.owner_aliases = cleaned
  }

  // Cross-field check: owner_phone and business_whatsapp must differ
  if (updates.owner_phone && updates.business_whatsapp && updates.owner_phone === updates.business_whatsapp) {
    return NextResponse.json({
      error: 'Owner phone and business WhatsApp must be different numbers',
    }, { status: 400 })
  }

  // If only one was changed, check against the other in DB
  if ((updates.owner_phone || updates.business_whatsapp) && !(updates.owner_phone && updates.business_whatsapp)) {
    const supabase = service()
    const { data: existing } = await supabase
      .from('agent_config')
      .select('owner_phone, business_whatsapp')
      .eq('client_id', clientId)
      .maybeSingle()

    const nextOwner = (updates.owner_phone ?? existing?.owner_phone) || null
    const nextBiz = (updates.business_whatsapp ?? existing?.business_whatsapp) || null
    if (nextOwner && nextBiz && nextOwner === nextBiz) {
      return NextResponse.json({
        error: 'Owner phone and business WhatsApp must be different numbers',
      }, { status: 400 })
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = service()
  const { error } = await supabase
    .from('agent_config')
    .update(updates)
    .eq('client_id', clientId)

  if (error) {
    return NextResponse.json({ error: 'Failed to save', detail: error.message }, { status: 500 })
  }

  // Enqueue a provisioning run so access.json + CLAUDE.md on the client's VPS
  // reflect the new numbers without operator intervention. Best-effort — the
  // dashboard save still succeeds if the queue insert fails.
  try {
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'apply_sender_roles',
      triggered_by: 'dashboard:sender-roles-patch',
      meta: {
        fields_changed: Object.keys(updates),
      },
    })
  } catch (e) {
    console.error('[sender-roles] failed to enqueue provisioning:', e)
  }

  return NextResponse.json({ success: true, queued: true })
}
