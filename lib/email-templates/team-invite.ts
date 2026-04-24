/**
 * Team-invite email template.
 *
 * Rendered by /api/team/invite (first-time) and /api/team/resend (re-send).
 * Kept in its own module so the plain-text fallback stays in sync with the
 * HTML and the wording lives in one place.
 *
 * We deliberately include:
 *   - the client's business name — so the recipient knows *what* they're
 *     being invited to (not a generic "the dashboard"); this dramatically
 *     cuts spam-report rates for transactional invites
 *   - the inviter's email — anti-phishing signal + accountability
 *   - Nexley branding in the footer — sets product context for recipients
 *     who have never heard of Nexley (most of them)
 *   - a plain-text fallback for spam-filter scoring + accessibility
 */

export interface InviteEmailInput {
  /** Business name the member is being invited to (e.g. "Joseph Solutions"). */
  clientName: string
  /** Who sent the invite — email or display name. */
  inviterName: string
  /** Full magic-link URL the recipient should click. */
  actionLink: string
  /** True when this is a re-send (changes the subject + opening line). */
  resend?: boolean
}

export interface InviteEmailOutput {
  subject: string
  html: string
  text: string
}

export function buildTeamInviteEmail(input: InviteEmailInput): InviteEmailOutput {
  const { clientName, inviterName, actionLink, resend } = input

  const subject = resend
    ? `New link to join ${clientName} on Nexley AI`
    : `You\u2019ve been invited to ${clientName} on Nexley AI`

  const openingLine = resend
    ? `Here\u2019s a fresh link to join ${escapeHtml(clientName)} on Nexley AI.`
    : `${escapeHtml(inviterName)} has invited you to join ${escapeHtml(
        clientName,
      )}\u2019s Nexley AI dashboard.`

  const text = [
    openingLine.replace(/&[^;]+;/g, ''),
    '',
    'Nexley AI is an AI Employee that handles WhatsApp, calls, and admin for',
    'UK service businesses. As a team member you\u2019ll be able to see every',
    'conversation, call, and booking your AI Employee handles — you won\u2019t',
    'be able to change settings or billing.',
    '',
    'Accept the invite:',
    actionLink,
    '',
    'This link expires in 24 hours. If you didn\u2019t expect this email, you',
    'can safely ignore it — no account is created until you click the link.',
    '',
    '— Nexley AI · nexley.ai',
  ].join('\n')

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0;">
              <div style="font-weight:700;font-size:14px;letter-spacing:-0.01em;color:#111827;">Nexley AI</div>
              <div style="font-size:12px;color:#6b7280;">Your AI Employee team</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 8px;">
              <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;font-weight:600;color:#111827;">${escapeHtml(subject)}</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#374151;">${openingLine}</p>
              <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#4b5563;">
                Nexley AI is an AI Employee that handles WhatsApp, calls, and admin for UK service businesses.
                As a team member you\u2019ll be able to see every conversation, call, and booking your AI Employee
                handles. You won\u2019t be able to change settings or billing.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:6px 32px 24px;">
              <a href="${actionLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;">Accept invite &rarr;</a>
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
                This link expires in 24 hours. If you didn\u2019t expect this email, you can safely ignore it &mdash;
                no account is created until you click the link.
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
