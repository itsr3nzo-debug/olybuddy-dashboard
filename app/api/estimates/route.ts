/**
 * POST /api/estimates — queue a plan upload for the client's AI Employee.
 *
 * No dashboard-side Anthropic call. The client's AI Employee on the VPS
 * already has a Claude Max subscription running Claude Code — it does the
 * vision pass + pricing draft itself using that subscription. This endpoint
 * only handles file storage + queue creation.
 *
 * Flow:
 *   1. User uploads PDF via /estimates dashboard page.
 *   2. Stash in Supabase storage, create estimates row status='awaiting_agent'.
 *   3. Agent polls /api/agent/pending-estimates on its regular cycle.
 *   4. Agent downloads the PDF, runs vision + pricing, writes back via
 *      PATCH /api/estimates/[id], WhatsApps the owner the draft.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { randomUUID } from 'crypto'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getClientId(): Promise<string | null> {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return (user?.app_metadata?.client_id as string | undefined) ?? null
}

// Pricing logic (pricing_rules + item_rates + loadings) lives in the agent
// skill `/estimate-assistant` — the dashboard no longer applies it server-side
// since we don't have a dashboard-side model. The PATCH route still recomputes
// pricing when the owner edits a take-off, using pricing_rules from Supabase.

export async function POST(req: NextRequest) {
  const clientId = await getClientId()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })

  const file = form.get('file') as File | null
  const title = (form.get('title') as string | null)?.trim()
  if (!file || !title) return NextResponse.json({ error: 'file and title required' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'PDF exceeds 50MB' }, { status: 413 })
  }

  const supabase = service()

  // 1. Stash file
  const ext = file.name.split('.').pop()?.toLowerCase() === 'pdf' ? 'pdf'
            : file.name.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg'
  const storagePath = `${clientId}/${randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('estimates')
    .upload(storagePath, buf, { contentType: file.type || 'application/pdf' })
  if (upErr) {
    console.error('storage upload failed:', upErr)
    return NextResponse.json({ error: 'Storage failed', detail: upErr.message }, { status: 500 })
  }

  // Signed URL for Claude to read + for later display
  const { data: signed } = await supabase.storage
    .from('estimates').createSignedUrl(storagePath, 60 * 60 * 24 * 7)

  // 2. Insert draft row
  const { data: estRow, error: insErr } = await supabase.from('estimates').insert({
    client_id: clientId,
    title,
    source_pdf_url: signed?.signedUrl ?? null,
    status: 'draft',
    meta: { storage_path: storagePath, file_size: buf.length, mime: file.type },
  }).select('*').single()

  if (insErr || !estRow) {
    return NextResponse.json({ error: 'Insert failed', detail: insErr?.message }, { status: 500 })
  }

  // 3. Mark as awaiting agent processing. The client's AI Employee polls
  //    /api/agent/pending-estimates (or hears the owner WhatsApp a plan
  //    directly via capture-job-note) and runs the vision pass + pricing
  //    itself using its Claude Max subscription. No dashboard Anthropic key.
  const { data: finalRow, error: updErr } = await supabase
    .from('estimates')
    .update({
      status: 'awaiting_agent',
      takeoff_review_notes: 'Uploaded via dashboard. Your AI Employee will process this on its next cycle (typically within 15 min during business hours) and WhatsApp you the draft take-off.',
    })
    .eq('id', estRow.id)
    .select('*')
    .single()

  if (updErr) {
    return NextResponse.json({ error: 'Update failed', detail: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, estimate: finalRow })
}
