/**
 * Integration provider abstraction.
 *
 * DA flagged Composio as a vendor lock-in risk: Series-A company, single
 * point of failure for Gmail/Calendar/etc, history of outages. This
 * interface hides Composio behind an abstraction so we can swap individual
 * actions to direct provider OAuth (Google, Microsoft, Slack) without
 * touching the LLM tool router.
 *
 * Day 1: only ComposioIntegrationProvider exists.
 * Day N: add DirectGoogleProvider for the top 3 Google actions; the registry
 *        below decides which provider gets each tool call.
 *
 * The interface is deliberately narrow — `execute(action, input, scope)` —
 * so adding a new provider is one class implementing one method.
 */

export interface IntegrationContext {
  /** Composio user_id / our client_id — same value, used to scope OAuth tokens. */
  clientId: string
}

export type IntegrationActionResult =
  | { ok: true; data: unknown }
  | { ok: false; code: 'not_connected' | 'auth_expired' | 'rate_limited' | 'provider_error'; message: string }

export interface IntegrationProvider {
  name: string
  /** Action ids this provider handles, e.g. ['GMAIL_SEND_EMAIL', 'GMAIL_FETCH_EMAILS'] */
  supportedActions: readonly string[]
  execute(action: string, input: unknown, ctx: IntegrationContext): Promise<IntegrationActionResult>
}

// ----- Composio implementation --------------------------------------------

export class ComposioIntegrationProvider implements IntegrationProvider {
  readonly name = 'composio'
  readonly supportedActions: readonly string[] = [
    'GMAIL_SEND_EMAIL',
    'GMAIL_FETCH_EMAILS',
    'GMAIL_REPLY',
    'GOOGLECALENDAR_CREATE_EVENT',
    'GOOGLECALENDAR_FIND_EVENT',
    'GOOGLECALENDAR_UPDATE_EVENT',
    'GOOGLECALENDAR_DELETE_EVENT',
    'GOOGLESHEETS_BATCH_UPDATE',
    'GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW',
    'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL',
    'HUBSPOT_CREATE_CONTACT',
    'HUBSPOT_GET_CONTACT',
  ]

  async execute(
    action: string,
    input: unknown,
    ctx: IntegrationContext
  ): Promise<IntegrationActionResult> {
    if (!this.supportedActions.includes(action)) {
      return { ok: false, code: 'provider_error', message: `Composio: unsupported action ${action}` }
    }
    try {
      // Lazy import — avoid loading Composio SDK on routes that don't use it
      const { Composio } = await import('@composio/core')
      const apiKey = process.env.COMPOSIO_API_KEY
      if (!apiKey) {
        return { ok: false, code: 'provider_error', message: 'COMPOSIO_API_KEY not configured' }
      }
      const composio = new Composio({ apiKey })
      const result = await composio.tools.execute(action, {
        userId: ctx.clientId,
        arguments: input as Record<string, unknown>,
      })
      // Composio returns { successful, data, error }
      const r = result as { successful?: boolean; data?: unknown; error?: string }
      if (r.successful === false) {
        const msg = r.error ?? 'Composio action failed'
        // DA B15 fix — broaden the auth-expired catch to cover the actual
        // strings Composio returns (audited against v0.6.x):
        //   • "Connection token expired"          (Composio core)
        //   • "AUTHENTICATION_FAILED"              (Composio surface)
        //   • "invalid_grant"                      (Google when refresh revoked)
        //   • "not_connected" / "auth_required"    (Composio per-account state)
        //   • "Token has been expired or revoked." (Google variant)
        const authExpired = [
          /unauthorized/i,
          /invalid.?credentials/i,
          /invalid[._-]?grant/i,
          /reauth/i,
          /expired/i,
          /authentication[._\s-]?failed/i,
          /not[._\s-]?connected/i,
          /auth[._\s-]?required/i,
          /token has been expired/i,
          /access[._\s-]?denied/i,
          /401/,
          /403/,
        ]
        if (authExpired.some((rx) => rx.test(msg))) {
          return { ok: false, code: 'auth_expired', message: msg }
        }
        if (/rate.?limit|too many requests|429/i.test(msg)) {
          return { ok: false, code: 'rate_limited', message: msg }
        }
        return { ok: false, code: 'provider_error', message: msg }
      }
      return { ok: true, data: r.data }
    } catch (err) {
      return { ok: false, code: 'provider_error', message: (err as Error).message }
    }
  }
}

// ----- Registry / router --------------------------------------------------

const _providers: IntegrationProvider[] = [new ComposioIntegrationProvider()]

/**
 * Pick the provider that handles `action`. First match wins — order in
 * `_providers` array is the override priority. To migrate a single action
 * off Composio: register the new provider FIRST in this list and only
 * include that action in its `supportedActions`.
 */
export function pickProvider(action: string): IntegrationProvider | null {
  for (const p of _providers) {
    if (p.supportedActions.includes(action)) return p
  }
  return null
}

export async function executeIntegrationAction(
  action: string,
  input: unknown,
  ctx: IntegrationContext
): Promise<IntegrationActionResult> {
  const provider = pickProvider(action)
  if (!provider) {
    return { ok: false, code: 'provider_error', message: `No provider for action ${action}` }
  }
  return provider.execute(action, input, ctx)
}
