import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'
import { sendSms } from '@/lib/twilio'

export async function POST(request: Request) {
  const body = await request.json()
  const { to, message, contact_id } = body

  if (!to || !message) {
    return NextResponse.json({ error: 'to and message required' }, { status: 400 })
  }

  if (message.length > 1600) {
    return NextResponse.json({ error: 'Message too long (max 1600 chars)' }, { status: 400 })
  }

  const auth = await authenticateAgentRequest(request, body.client_id)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await sendSms(to, message, auth.clientId, contact_id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, messageId: result.messageId })
}
