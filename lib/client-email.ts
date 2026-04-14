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
  clientId?: string
  accessToken?: string
  refreshToken?: string
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
}

/** Refresh an expired OAuth token and save the new one back to Supabase */
async function refreshOAuthToken(config: ClientEmailConfig): Promise<string | null> {
  if (!config.refreshToken || !config.clientId) return null

  try {
    let tokenUrl: string
    let tokenBody: URLSearchParams

    if (config.provider === 'gmail') {
      tokenUrl = 'https://oauth2.googleapis.com/token'
      tokenBody = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      })
    } else if (config.provider === 'outlook') {
      const tenantId = process.env.MICROSOFT_TENANT_ID ?? 'common'
      tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
      tokenBody = new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID ?? '',
        client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      })
    } else {
      return null
    }

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    })

    if (!resp.ok) {
      console.error(`Token refresh failed for ${config.provider}:`, await resp.text())
      return null
    }

    const data = await resp.json()
    const newAccessToken = data.access_token as string

    // Save refreshed token back to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: existing } = await supabase
      .from('agent_config')
      .select('notification_prefs')
      .eq('client_id', config.clientId)
      .single()

    if (existing) {
      const prefs = (existing.notification_prefs ?? {}) as Record<string, unknown>
      const emailConfig = (prefs.email_config ?? {}) as Record<string, unknown>
      emailConfig.access_token = newAccessToken
      if (data.refresh_token) emailConfig.refresh_token = data.refresh_token
      prefs.email_config = emailConfig

      await supabase
        .from('agent_config')
        .update({ notification_prefs: prefs })
        .eq('client_id', config.clientId)
    }

    return newAccessToken
  } catch (e) {
    console.error('Token refresh error:', e)
    return null
  }
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
    // Add clientId to config for token refresh
    config.clientId = clientId

    if (config.provider === 'gmail' && (config.accessToken || config.refreshToken)) {
      // Try existing token, refresh if needed
      let token = config.accessToken
      if (!token && config.refreshToken) {
        token = await refreshOAuthToken(config) ?? undefined
      }
      if (!token) return { success: false, error: 'Gmail token expired and refresh failed' }

      transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: config.email,
          accessToken: token,
        },
      })
    } else if (config.provider === 'outlook' && (config.accessToken || config.refreshToken)) {
      let token = config.accessToken
      if (!token && config.refreshToken) {
        token = await refreshOAuthToken(config) ?? undefined
      }
      if (!token) return { success: false, error: 'Outlook token expired and refresh failed' }

      transporter = nodemailer.createTransport({
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        auth: {
          type: 'OAuth2',
          user: config.email,
          accessToken: token,
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

    let result: nodemailer.SentMessageInfo
    try {
      result = await transporter.sendMail({ from: config.email, to, subject, text: body, html: html ?? body })
    } catch (sendErr: unknown) {
      // If auth failed, try refreshing the token once and retry
      const errMsg = sendErr instanceof Error ? sendErr.message : ''
      if ((config.provider === 'gmail' || config.provider === 'outlook') && config.refreshToken &&
          (errMsg.includes('Invalid credentials') || errMsg.includes('auth') || errMsg.includes('535'))) {
        const newToken = await refreshOAuthToken(config)
        if (!newToken) return { success: false, error: `Token refresh failed after send error: ${errMsg}` }

        const retryTransporter = nodemailer.createTransport({
          host: config.provider === 'gmail' ? 'smtp.gmail.com' : 'smtp.office365.com',
          port: config.provider === 'gmail' ? 465 : 587,
          secure: config.provider === 'gmail',
          auth: { type: 'OAuth2', user: config.email, accessToken: newToken },
        })
        result = await retryTransporter.sendMail({ from: config.email, to, subject, text: body, html: html ?? body })
      } else {
        throw sendErr
      }
    }

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
