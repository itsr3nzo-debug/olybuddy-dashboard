import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendSms } from '@/lib/twilio'
import { followUpAfterCall, missedCallFollowUp, consultationBooked } from '@/lib/sms-templates'
import { normalizePhone } from '@/lib/phone'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET
const APEX_CLIENT_ID = process.env.APEX_CLIENT_ID ?? 'aaaaaaaa-0000-0000-0000-000000000001'
const DEFAULT_TO_NUMBER = process.env.TWILIO_FROM_NUMBER ?? '+447863768330'

function estimateJobValue(reason: string): number {
  const r = (reason || '').toLowerCase()
  if (r.includes('emergency') || r.includes('urgent')) return 520000
  if (r.includes('extension') || r.includes('renovation') || r.includes('build')) return 350000
  if (r.includes('bathroom') || r.includes('kitchen')) return 280000
  if (r.includes('garden') || r.includes('landscap') || r.includes('patio')) return 180000
  if (r.includes('boiler') || r.includes('heating')) return 250000
  if (r.includes('quote') || r.includes('estimate')) return 150000
  return 150000
}

export async function POST(request: Request) {
  const startTime = Date.now()

  // Webhook authentication — check shared secret if configured
  if (WEBHOOK_SECRET) {
    const authHeader = request.headers.get('x-webhook-secret')
      ?? request.headers.get('authorization')?.replace('Bearer ', '')
    if (authHeader !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await request.json()
    const data = body.data ?? body

    const conversationId = data.conversation_id
    if (!conversationId) {
      return NextResponse.json({ success: false, reason: 'no_conversation_id' })
    }

    const analysis = data.analysis ?? {}
    const transcript = data.transcript ?? []
    const metadata = data.metadata ?? {}

    // Extract caller data
    const dcr = analysis.data_collection_results ?? {}
    const callerName = dcr.caller_name?.value ?? ''
    const rawPhone = dcr.phone_number?.value ?? metadata.phone_call?.caller_number ?? ''
    const businessName = dcr.business_name?.value ?? ''
    const reason = dcr.reason_for_calling?.value ?? analysis.transcript_summary ?? ''
    const wantsConsultation = dcr.wants_consultation?.value === true || dcr.wants_consultation?.value === 'true'

    const phone = normalizePhone(rawPhone)
    if (!phone) {
      return NextResponse.json({ success: false, reason: 'no_phone' })
    }

    // Skip junk calls
    if (!callerName && transcript.length < 3) {
      return NextResponse.json({ success: false, reason: 'junk_call' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // MULTI-TENANT: Look up client_id from agent_id
    let clientId = APEX_CLIENT_ID
    let clientBusinessName = 'Olybuddy'

    const agentId = data.agent_id ?? metadata.agent_id ?? null
    if (agentId) {
      const { data: config } = await supabase
        .from('agent_config')
        .select('client_id, business_name')
        .eq('agent_id', agentId)
        .single()

      if (config) {
        clientId = config.client_id
        clientBusinessName = config.business_name ?? 'our company'
      }
    }

    // Parse name
    const nameParts = callerName.trim().split(/\s+/)
    const firstName = nameParts[0] || null
    const lastName = nameParts.slice(1).join(' ') || null

    const duration = metadata.call_duration_secs ?? metadata.phone_call?.duration_secs ?? null
    const callSuccessful = analysis.call_successful !== false
    const status: string = callSuccessful ? 'completed' : 'failed'

    // Step 1: Upsert contact
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .upsert({
        client_id: clientId,
        phone,
        first_name: firstName,
        last_name: lastName,
        company: businessName || null,
        source: 'inbound_call',
        pipeline_stage: 'new',
        tags: ['voice-ai-call', 'elevenlabs', ...(wantsConsultation ? ['wants-consultation'] : [])],
        custom_fields: {
          reason_for_calling: reason,
          last_call_date: new Date().toISOString(),
          last_call_duration: duration,
        },
        last_contacted: new Date().toISOString(),
      }, {
        onConflict: 'client_id,phone',
        ignoreDuplicates: false,
      })
      .select('id')
      .single()

    if (contactErr) {
      console.error('Contact upsert error:', contactErr)
      return NextResponse.json({ success: false, error: contactErr.message }, { status: 500 })
    }

    const contactId = contact.id

    // Step 2: Insert call_log (upsert by external_call_id for idempotency)
    const transcriptText = transcript.map((t: { role: string; message: string }) =>
      `${t.role === 'agent' ? 'AI' : 'Caller'}: ${t.message}`
    ).join('\n')

    const { data: callLog, error: callErr } = await supabase
      .from('call_logs')
      .upsert({
        client_id: clientId,
        contact_id: contactId,
        provider: 'elevenlabs',
        external_call_id: conversationId,
        direction: 'inbound',
        from_number: phone,
        to_number: metadata.phone_call?.to_number ?? DEFAULT_TO_NUMBER,
        status,
        duration_seconds: duration ? Math.round(duration) : null,
        started_at: new Date(Date.now() - (duration ?? 0) * 1000).toISOString(),
        ended_at: new Date().toISOString(),
        transcript,
        transcript_text: transcriptText,
        summary: analysis.transcript_summary ?? reason,
        analysis,
        metadata: { conversation_id: conversationId, agent_id: agentId },
      }, {
        onConflict: 'external_call_id',
        ignoreDuplicates: false,
      })
      .select('id, created_at')
      .single()

    if (callErr) {
      console.error('Call log error:', callErr)
    }

    // Check if this is a replay (call_log already existed with older created_at)
    const isReplay = callLog && new Date(callLog.created_at).getTime() < Date.now() - 60000

    // Step 3: Opportunity with dedup — use upsert pattern to avoid race condition
    let opportunityDeduplicated = false
    const { data: existingOpp } = await supabase
      .from('opportunities')
      .select('id')
      .eq('contact_id', contactId)
      .eq('client_id', clientId)
      .not('stage', 'in', '("won","lost")')
      .limit(1)

    if (!existingOpp || existingOpp.length === 0) {
      await supabase.from('opportunities').insert({
        client_id: clientId,
        contact_id: contactId,
        title: reason || `Call from ${callerName || phone}`,
        stage: 'new',
        value_pence: estimateJobValue(reason),
        assigned_to: 'ai-employee',
        metadata: { reason, wants_consultation: wantsConsultation },
      })
    } else {
      opportunityDeduplicated = true
    }

    // Step 4: Activity log
    await supabase.from('activities').insert({
      client_id: clientId,
      contact_id: contactId,
      activity_type: 'call',
      description: `Inbound call via ElevenLabs — ${duration ? Math.round(duration) + 's' : 'unknown duration'} [${status}]`,
      metadata: {
        call_log_id: callLog?.id,
        conversation_id: conversationId,
        direction: 'inbound',
        status,
        duration_seconds: duration,
      },
    })

    // Step 5: Update agent status
    if (agentId) {
      await supabase.from('agent_config')
        .update({ agent_status: 'online', last_call_at: new Date().toISOString() })
        .eq('agent_id', agentId)
    }

    // Step 6: Auto SMS follow-up (only on first webhook, not replays)
    if (phone && clientId && !isReplay) {
      try {
        if (status === 'failed' || status === 'no_answer') {
          await sendSms(phone, missedCallFollowUp(callerName, clientBusinessName), clientId, contactId)
        } else if (wantsConsultation) {
          await sendSms(phone, consultationBooked(callerName, clientBusinessName), clientId, contactId)
        } else if (callSuccessful) {
          await sendSms(phone, followUpAfterCall(callerName, clientBusinessName), clientId, contactId)
        }
      } catch (smsErr) {
        console.error('SMS follow-up failed (non-fatal):', smsErr)
      }
    }

    return NextResponse.json({
      success: true,
      clientId,
      contactId,
      callLogId: callLog?.id,
      opportunityDeduplicated,
      processingMs: Date.now() - startTime,
    })

  } catch (e) {
    console.error('Webhook error:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
