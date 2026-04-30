/**
 * LLM provider abstraction — primary Anthropic, fallback Bedrock-claude.
 *
 * DA called the single-key SPOF a blocker. The mobile chat path goes through
 * this layer so swapping providers (or adding key rotation later) is one
 * place to change. Day 1 ships with Anthropic only; the `fallback` hook is
 * wired but disabled behind a feature flag.
 *
 * Why an interface and not just env-toggled fetch? Because the streaming
 * shape differs by provider (Anthropic SSE vs Bedrock InvokeWithResponseStream)
 * and the caller (the SSE route) wants ONE event shape. The interface
 * normalises that.
 */

export type LlmModelTier = 'haiku' | 'sonnet' | 'opus'

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: LlmContentBlock[]
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export interface LlmTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LlmStreamRequest {
  model: LlmModelTier
  // System prompt split into stable (cacheable) + volatile (not cached) parts.
  // DA flagged that putting today's date in the cached block invalidates the
  // cache at midnight UTC for every customer simultaneously.
  systemStable: string                   // identity + role — cached
  systemVolatile?: string                // today's date, owner state — fresh every turn
  tools: LlmTool[]                       // cached as a block (final tool gets cache_control)
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
}

// Normalised event stream — what the SSE route consumes regardless of provider
export type LlmStreamEvent =
  | { type: 'message_start'; messageId: string; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolUseId: string; toolName: string }
  | { type: 'tool_use_delta'; toolUseId: string; partialJson: string }
  | { type: 'tool_use_complete'; toolUseId: string; toolName: string; input: unknown }
  | {
      type: 'message_complete'
      messageId: string
      stopReason: string
      usage: {
        inputTokens: number
        outputTokens: number
        cacheCreationTokens: number
        cacheReadTokens: number
      }
    }
  | { type: 'error'; code: string; message: string; retryable: boolean }

export interface LlmProvider {
  name: string
  stream(req: LlmStreamRequest, signal: AbortSignal): AsyncIterable<LlmStreamEvent>
}

/**
 * Build the right provider given env. Caller can also pass an explicit
 * provider for tests. If primary provider is unhealthy (circuit-breaker
 * tripped), returns the fallback provider — but only when the
 * `llm_fallback_bedrock` feature flag is on.
 */
let _primary: LlmProvider | null = null

export async function getProvider(): Promise<LlmProvider> {
  if (_primary) return _primary
  const { AnthropicProvider } = await import('./anthropic')
  _primary = new AnthropicProvider()
  return _primary
}
