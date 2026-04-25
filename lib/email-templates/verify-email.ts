/**
 * Email-verification message — sent immediately after signup, plus on
 * resend from the dashboard banner. Visual style follows team-invite.ts
 * so transactional emails from Nexley AI feel like one product.
 *
 * Tokens live for 24h (see VERIFICATION_TTL_HOURS in
 * lib/auth/email-verification.ts).
 */

export interface VerifyEmailInput {
  /** Business name on file (e.g. "Joseph Solutions") for personalisation. */
  businessName: string
  /** Full URL the recipient should click. Includes ?token=…&id=… */
  actionLink: string
  /** TTL in hours, displayed in the email footer. */
  expiresInHours: number
}

export interface VerifyEmailOutput {
  subject: string
  html: string
  text: string
}

export function buildVerifyEmailMessage(input: VerifyEmailInput): VerifyEmailOutput {
  const { businessName, actionLink, expiresInHours } = input

  const subject = `Verify your email for ${businessName} on Nexley AI`

  const text = [
    `Welcome to Nexley AI — please confirm this is your email so we can`,
    `secure ${businessName}'s dashboard and route important alerts here.`,
    '',
    'Click to verify:',
    actionLink,
    '',
    `This link expires in ${expiresInHours} hours. If you didn't sign up for`,
    `Nexley AI you can safely ignore this email.`,
    '',
    '— Nexley AI · nexley.ai',
  ].join('\n')

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0;">
              <div style="font-weight:700;font-size:14px;letter-spacing:-0.01em;color:#111827;">Nexley AI</div>
              <div style="font-size:12px;color:#6b7280;">Your AI Employee dashboard</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px;">
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:600;color:#111827;">Confirm your email</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">
                Welcome to Nexley AI \u2014 please confirm this is your email so we can secure
                ${escapeHtml(businessName)}\u2019s dashboard and route important alerts (call summaries,
                booking confirmations, billing receipts) here.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:6px 32px 24px;">
              <a href="${actionLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Verify my email &rarr;</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:#6b7280;">
                If the button doesn\u2019t work, copy and paste this URL into your browser:<br />
                <span style="word-break:break-all;color:#4b5563;">${actionLink}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 24px;border-top:1px solid #f1f2f6;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:#9ca3af;">
                This link expires in ${expiresInHours} hours. If you didn\u2019t sign up for Nexley AI
                you can safely ignore this email \u2014 no action is needed.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">Nexley AI &middot; <a href="https://nexley.ai" style="color:#9ca3af;text-decoration:underline;">nexley.ai</a></p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()

  return { subject, html, text }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
