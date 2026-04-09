import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'
import { sendClientEmail, getClientEmailConfig } from '@/lib/client-email'

export async function POST(request: Request) {
  const body = await request.json()
  const { to, subject, message, contact_id } = body

  if (!to || !subject || !message) {
    return NextResponse.json({ error: 'to, subject, and message required' }, { status: 400 })
  }

  const auth = await authenticateAgentRequest(request, body.client_id)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Get client's email config
  const config = await getClientEmailConfig(auth.clientId)
  if (!config) {
    return NextResponse.json({
      error: 'No email account connected. The client needs to connect their Gmail or Outlook in Settings.',
      code: 'NO_EMAIL_CONFIG',
    }, { status: 400 })
  }

  const result = await sendClientEmail(
    config,
    auth.clientId,
    contact_id ?? null,
    to,
    subject,
    message,
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    messageId: result.messageId,
    sentFrom: config.email,
  })
}
