/** Twilio SMS helper — sends SMS and logs to comms_log */

import { createClient } from '@supabase/supabase-js'

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')
  if (cleaned.startsWith('0') && cleaned.length >= 10) {
    cleaned = '+44' + cleaned.slice(1)
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+44' + cleaned
  }
  return cleaned
}

export async function sendSms(
  to: string,
  body: string,
  clientId: string,
  contactId?: string | null
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const normalizedTo = normalizePhone(to)

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  try {
    // Send via Twilio REST API
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: normalizedTo,
          From: TWILIO_FROM,
          Body: body,
        }),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('Twilio SMS error:', data)
      return { success: false, error: data.message ?? 'SMS send failed' }
    }

    // Log to comms_log (best-effort, non-fatal)
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await supabase.from('comms_log').insert({
        client_id: clientId,
        contact_id: contactId ?? null,
        channel: 'sms',
        direction: 'outbound',
        body,
        status: 'sent',
        provider: 'twilio',
        external_id: data.sid,
      })
    } catch (logErr) {
      console.error('Failed to log SMS to comms_log:', logErr)
    }

    return { success: true, messageId: data.sid }
  } catch (e) {
    console.error('SMS send exception:', e)
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}
