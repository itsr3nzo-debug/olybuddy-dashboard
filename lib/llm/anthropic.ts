/**
 * Anthropic Messages API — streaming with prompt caching.
 *
 * Native fetch, no SDK (matches the existing lib/claude.ts pattern). The SDK
 * would add 200KB+ to every cold-start and the streaming surface we need is
 * straightforward to wire by hand.
 *
 * Caching strategy (per DA fix):
 *   - systemStable goes in `system: [{ type: 'text', text: ..., cache_control: { type: 'ephemeral' } }]`
 *   - tools array gets cache_control on the LAST tool only (which caches everything before it)
 *   - systemVolatile (today's date, owner state) is appended as a SECOND system block AFTER the cached one — fresh every turn
 *   - messages array is never cached
 *
 * That gives us exactly 2 cache breakpoints (out of 4 max), leaving headroom
 * for per-conversation context caching later if it becomes valuable.
 *
 * Idle-timeout watchdog (per DA): we monitor *upstream* bytes from Anthropic.
 * If 90s elapse with zero upstream activity, we abort. 90s vs 60s because a
 * legitimately complex tool_use block can pause briefly while Claude reasons.
 */

import type {
  LlmProvider,
  LlmStreamRequest,
  LlmStreamEvent,
  LlmModelTier,
} from './provider'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const MODEL_IDS: Record<LlmModelTier, string> = {
  // Pinned IDs — bump when new versions release. Source of truth: lib/claude.ts
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6-20260401',
  opus: 'claude-opus-4-7-20260425',
}

const IDLE_TIMEOUT_MS = 90_000

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic'

  async *stream(
    req: LlmStreamRequest,
    signal: AbortSignal
  ): AsyncIterable<LlmStreamEvent> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      yield { type: 'error', code: 'config', message: 'ANTHROPIC_API_KEY missing', retryable: false }
      return
    }

    // Build system as an array of blocks: cached stable + volatile suffix.
    const systemBlocks: Array<{
      type: 'text'
      text: string
      cache_control?: { type: 'ephemeral' }
    }> = [
      {
        type: 'text',
        text: req.systemStable,
        cache_control: { type: 'ephemeral' },
      },
    ]
    if (req.systemVolatile) {
      systemBlocks.push({ type: 'text', text: req.systemVolatile })
    }

    // Apply cache_control to the last tool, which caches the whole tool array
    // up to and including that block.
    const tools = req.tools.map((t, i) =>
      i === req.tools.length - 1
        ? { ...t, cache_control: { type: 'ephemeral' as const } }
        : t
    )

    const body = {
      model: MODEL_IDS[req.model],
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: systemBlocks,
      tools: tools.length > 0 ? tools : undefined,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }

    let response: Response
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      yield {
        type: 'error',
        code: 'network',
        message: (err as Error).message,
        retryable: true,
      }
      return
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      // Map Anthropic status codes to retryable hints
      const retryable = response.status === 429 || response.status >= 500
      yield {
        type: 'error',
        code: `http_${response.status}`,
        message: errBody.slice(0, 500) || `HTTP ${response.status}`,
        retryable,
      }
      return
    }

    if (!response.body) {
      yield { type: 'error', code: 'no_body', message: 'No response stream', retryable: true }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastUpstreamAt = Date.now()
    let messageId = ''
    let aborted = false
    const toolUseBuffers = new Map<number, { id: string; name: string; partial: string }>()

    // Idle watchdog — sets `aborted` then cancels reader. Reader.cancel on
    // a closed/locked reader rejects; .catch() swallows. The next read()
    // will throw AbortError or return done — we break either way.
    const watchdog = setInterval(() => {
      if (Date.now() - lastUpstreamAt > IDLE_TIMEOUT_MS) {
        aborted = true
        reader.cancel().catch(() => {})
      }
    }, 5_000)

    try {
      while (true) {
        if (signal.aborted || aborted) {
          await reader.cancel().catch(() => {})
          break
        }
        // M1 fix — wrap read() to handle abort mid-await
        let value: Uint8Array | undefined
        let done = false
        try {
          const r = await reader.read()
          value = r.value
          done = r.done
        } catch (err) {
          // AbortError from upstream cancellation, or any read failure
          if ((err as Error).name === 'AbortError' || aborted || signal.aborted) break
          throw err
        }
        if (done) break
        lastUpstreamAt = Date.now()
        buffer += decoder.decode(value, { stream: true })

        // SSE frames separated by blank lines
        let blankIdx = buffer.indexOf('\n\n')
        while (blankIdx !== -1) {
          const frame = buffer.slice(0, blankIdx)
          buffer = buffer.slice(blankIdx + 2)
          blankIdx = buffer.indexOf('\n\n')

          // Parse `event: <name>\ndata: <json>` shape
          const lines = frame.split('\n')
          let eventName = ''
          let dataText = ''
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataText += line.slice(5).trim()
          }
          if (!dataText) continue

          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(dataText)
          } catch {
            continue
          }

          const out = mapAnthropicEvent(eventName, payload, toolUseBuffers, (id) => {
            messageId = id
          })
          if (out) yield out
        }
      }

      // If we reached here without hitting message_complete, surface idle timeout
      if (!messageId) {
        yield {
          type: 'error',
          code: 'idle_timeout',
          message: 'Upstream went silent without completing.',
          retryable: true,
        }
      }
    } finally {
      clearInterval(watchdog)
    }
  }
}

/** Translate Anthropic SSE events into our normalised LlmStreamEvent shape. */
function mapAnthropicEvent(
  name: string,
  payload: Record<string, unknown>,
  toolUseBuffers: Map<number, { id: string; name: string; partial: string }>,
  onMessageId: (id: string) => void
): LlmStreamEvent | null {
  switch (name) {
    case 'message_start': {
      const msg = (payload as { message?: { id?: string; model?: string } }).message
      const id = msg?.id ?? ''
      onMessageId(id)
      return { type: 'message_start', messageId: id, model: msg?.model ?? '' }
    }
    case 'content_block_start': {
      const block = (payload as { content_block?: { type?: string; id?: string; name?: string } })
        .content_block
      const idx = (payload as { index?: number }).index ?? 0
      if (block?.type === 'tool_use' && block.id && block.name) {
        toolUseBuffers.set(idx, { id: block.id, name: block.name, partial: '' })
        return { type: 'tool_use_start', toolUseId: block.id, toolName: block.name }
      }
      return null
    }
    case 'content_block_delta': {
      const idx = (payload as { index?: number }).index ?? 0
      const delta = (payload as { delta?: { type?: string; text?: string; partial_json?: string } })
        .delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return { type: 'text_delta', text: delta.text }
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tu = toolUseBuffers.get(idx)
        if (tu) tu.partial += delta.partial_json
        return {
          type: 'tool_use_delta',
          toolUseId: tu?.id ?? '',
          partialJson: delta.partial_json,
        }
      }
      return null
    }
    case 'content_block_stop': {
      const idx = (payload as { index?: number }).index ?? 0
      const tu = toolUseBuffers.get(idx)
      if (tu) {
        toolUseBuffers.delete(idx)
        let parsed: unknown = {}
        try {
          parsed = tu.partial ? JSON.parse(tu.partial) : {}
        } catch {
          /* keep empty */
        }
        return {
          type: 'tool_use_complete',
          toolUseId: tu.id,
          toolName: tu.name,
          input: parsed,
        }
      }
      return null
    }
    case 'message_delta': {
      // Anthropic sends usage updates here; we accumulate but emit on stop
      return null
    }
    case 'message_stop': {
      const u = (
        payload as {
          'amazon-bedrock-invocationMetrics'?: unknown
          message?: {
            id?: string
            stop_reason?: string
            usage?: {
              input_tokens?: number
              output_tokens?: number
              cache_creation_input_tokens?: number
              cache_read_input_tokens?: number
            }
          }
        }
      ).message
      return {
        type: 'message_complete',
        messageId: u?.id ?? '',
        stopReason: u?.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: u?.usage?.input_tokens ?? 0,
          outputTokens: u?.usage?.output_tokens ?? 0,
          cacheCreationTokens: u?.usage?.cache_creation_input_tokens ?? 0,
          cacheReadTokens: u?.usage?.cache_read_input_tokens ?? 0,
        },
      }
    }
    case 'error': {
      const e = (payload as { error?: { type?: string; message?: string } }).error
      return {
        type: 'error',
        code: e?.type ?? 'unknown',
        message: e?.message ?? 'Anthropic returned an error event',
        retryable: e?.type === 'overloaded_error' || e?.type === 'api_error',
      }
    }
    default:
      return null
  }
}
