/** Client email sender — sends emails FROM the client's own email account
 * Supports Gmail (Google OAuth) and Outlook (Microsoft Graph)
 * Logs all sent emails to comms_log for dashboard tracking
 */

import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface ClientEmailConfig {
  provider: 'gmail' | 'outlook' | 'smtp'
  email: string
  // For Gmail: OAuth2 access token
  accessToken?: string
  refreshToken?: string
  // For generic SMTP
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
}

export async function sendClientEmail(
  config: ClientEmailConfig,
  clientId: string,
  contactId: string | null,
  to: string,
  subject: string,
  body: string,
  html?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let transporter: nodemailer.Transporter

    if (config.provider === 'gmail' && config.accessToken) {
      // Gmail via OAuth2
      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: config.email,
          accessToken: config.accessToken,
        },
      })
    } else if (config.provider === 'outlook' && config.accessToken) {
      // Outlook via OAuth2
      transporter = nodemailer.createTransport({
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        auth: {
          type: 'OAuth2',
          user: config.email,
          accessToken: config.accessToken,
        },
      })
    } else if (config.smtpHost && config.smtpUser && config.smtpPass) {
      // Generic SMTP
      transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort ?? 587,
        secure: (config.smtpPort ?? 587) === 465,
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      })
    } else {
      return { success: false, error: 'No valid email configuration found' }
    }

    const result = await transporter.sendMail({
      from: config.email,
      to,
      subject,
      text: body,
      html: html ?? body,
    })

    // Log to comms_log for dashboard tracking
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await supabase.from('comms_log').insert({
        client_id: clientId,
        contact_id: contactId,
        channel: 'email',
        direction: 'outbound',
        subject,
        body,
        status: 'sent',
        provider: config.provider,
        external_id: result.messageId,
        metadata: { from: config.email, to },
      })
    } catch (logErr) {
      console.error('Failed to log client email to comms_log:', logErr)
    }

    return { success: true, messageId: result.messageId }
  } catch (e) {
    console.error('Client email send failed:', e)
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

/** Get client email config from agent_config.notification_prefs or metadata */
export async function getClientEmailConfig(clientId: string): Promise<ClientEmailConfig | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { data } = await supabase
    .from('agent_config')
    .select('notification_prefs, business_name')
    .eq('client_id', clientId)
    .single()

  if (!data) return null

  const prefs = (data.notification_prefs ?? {}) as Record<string, unknown>
  const emailConfig = prefs.email_config as Record<string, unknown> | undefined

  if (!emailConfig) return null

  return {
    provider: (emailConfig.provider as string) as 'gmail' | 'outlook' | 'smtp',
    email: emailConfig.email as string,
    accessToken: emailConfig.access_token as string | undefined,
    refreshToken: emailConfig.refresh_token as string | undefined,
    smtpHost: emailConfig.smtp_host as string | undefined,
    smtpPort: emailConfig.smtp_port as number | undefined,
    smtpUser: emailConfig.smtp_user as string | undefined,
    smtpPass: emailConfig.smtp_pass as string | undefined,
  }
}
