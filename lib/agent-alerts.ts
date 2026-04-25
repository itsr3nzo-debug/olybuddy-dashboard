/**
 * Item #11 — agent-routed alerts.
 *
 * The Mac Mini Squad (Light/Senku/Itachi/L/Shikamaru) has full operational
 * context: which client owns which VPS, what their churn risk is, whose
 * campaign is mid-flight. So when something goes sideways, we don't blast
 * a Telegram alert into the void and hope a human notices — we route it to
 * the agent best positioned to decide the next move.
 *
 *   - Light (Opus 4.6, boss/coordinator) — default destination. He routes
 *     to other agents or pings the user.
 *   - Senku (Sonnet, intel/campaigns) — Smartlead/Instantly/prospect work.
 *   - Itachi (Sonnet, builder) — VPS provisioning, infra, demo sites.
 *   - L (Sonnet, lead pipeline owner) — anything touching the Sheet.
 *   - Shikamaru (Haiku, QA + monitoring) — uptime + domain health.
 *
 * Dashboard cron / webhook calls dispatchAgentAlert() which writes a row
 * to Supabase agent_alerts. The Mac Mini poller (com.nexley.agent-alerts-
 * poller launchd plist, 60s) materialises rows into shared/memory/inbox/
 * {agent}/ as markdown files and marks them processed.
 *
 * For P0 (immediate) alerts we also fire a Telegram alert as a fallback so
 * the user is paged even if the Squad is offline / waiting on /login. P1
 * and below trust the agent loop entirely.
 */
import { createClient } from '@supabase/supabase-js'

export type SquadAgent = 'light' | 'itachi' | 'senku' | 'l' | 'shikamaru'
export type AlertPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface AgentAlertInput {
  /** Default 'light' — he coordinates. */
  target?: SquadAgent
  /** P0 = wake-the-house. P1 = today. P2 = this week. P3 = backlog. */
  priority?: AlertPriority
  /** Free-form category — billing, vps, security, churn, deploy, etc. */
  category: string
  /** One-line summary, becomes the inbox filename. */
  subject: string
  /** Full markdown body with context, links, suggested actions. */
  body: string
  /** Optional metadata (client_id, error stack, sub_id, etc). */
  meta?: Record<string, unknown>
  /** Where the alert came from (cron name, route path, etc). */
  source?: string
  /** If alert is client-scoped, link it. */
  clientId?: string
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Fire-and-forget alert dispatch. Returns ok=true once persisted; the
 * Mac Mini poller picks it up within ~60s. Throws never — alerting must
 * not break the calling path.
 */
export async function dispatchAgentAlert(input: AgentAlertInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const target = input.target ?? 'light'
  const priority = input.priority ?? 'P2'

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data, error } = await supabase
      .from('agent_alerts')
      .insert({
        target_agent: target,
        priority,
        category: input.category,
        subject: input.subject.slice(0, 200),
        body: input.body,
        meta: input.meta ?? {},
        source: input.source,
        client_id: input.clientId,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[agent-alerts] DB insert failed:', error.message)
      // Fallback: at least page the user via Telegram so the alert isn't lost.
      void telegramFallback(input)
      return { ok: false, error: error.message }
    }

    // P0 also fires Telegram immediately. Squad is the source of truth for
    // *handling*, but for "wake-the-house" we want the user paged in seconds
    // even if their tmux session is offline.
    if (priority === 'P0') {
      void telegramFallback(input)
    }

    return { ok: true, id: data?.id }
  } catch (e) {
    console.error('[agent-alerts] unexpected:', e)
    void telegramFallback(input)
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown' }
  }
}

async function telegramFallback(input: AgentAlertInput): Promise<void> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!botToken || !chatId) return
    const priority = input.priority ?? 'P2'
    const target = input.target ?? 'light'
    const lines = [
      `\u26A0\uFE0F *${priority} \u2014 ${input.category}*`,
      `\u2192 ${input.subject}`,
      `(routed to: ${target})`,
      input.body.slice(0, 500),
    ].join('\n')
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines, parse_mode: 'Markdown' }),
    })
  } catch { /* best-effort */ }
}
