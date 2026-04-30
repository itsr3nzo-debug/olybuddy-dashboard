/**
 * Tool schemas for the Anthropic Messages API.
 *
 * Each tool here produces an `LlmTool` (input_schema + name + description)
 * that gets passed into the messages call. When the model emits a tool_use
 * block, the SSE route dispatches to `executeIntegrationAction` (Composio
 * et al) for `composio:` tools, or a local function for internal tools.
 *
 * Caching: the LAST tool in the array gets `cache_control: ephemeral` —
 * that's how Anthropic caches the entire tools array.
 */

import type { LlmTool } from './provider'

export interface ToolDefinition extends LlmTool {
  /** Where the dispatcher routes this — composio action id or internal fn name */
  dispatch:
    | { kind: 'composio'; action: string }
    | { kind: 'internal'; fn: string }
}

export const ALL_TOOLS: ToolDefinition[] = [
  // ----- Composio-backed -----
  {
    name: 'gmail_send_email',
    description:
      'Send an email from the connected Gmail account. Use sparingly — only when the customer needs something formal in writing.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text body, no HTML.' },
      },
      required: ['to', 'subject', 'body'],
    },
    dispatch: { kind: 'composio', action: 'GMAIL_SEND_EMAIL' },
  },
  {
    name: 'calendar_find_event',
    description:
      'Look up calendar events in a date range. Use to check if the owner is available before suggesting a slot.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 datetime (UK timezone).' },
        end: { type: 'string', description: 'ISO 8601 datetime.' },
      },
      required: ['start', 'end'],
    },
    dispatch: { kind: 'composio', action: 'GOOGLECALENDAR_FIND_EVENT' },
  },
  {
    name: 'calendar_create_event',
    description:
      'Book a slot in the owner\'s calendar. Always confirm with the customer first — never auto-book without their agreement.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 datetime (UK timezone).' },
        end: { type: 'string', description: 'ISO 8601 datetime.' },
        description: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['title', 'start', 'end'],
    },
    dispatch: { kind: 'composio', action: 'GOOGLECALENDAR_CREATE_EVENT' },
  },

  // ----- Internal -----
  {
    name: 'lookup_customer',
    description:
      'Look up a customer in the contacts table by phone or email. Returns previous interactions if any.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        email: { type: 'string' },
      },
    },
    dispatch: { kind: 'internal', fn: 'lookupCustomer' },
  },
  {
    name: 'create_estimate',
    description:
      'Draft an estimate for the owner to approve. Goes to the estimates queue — does NOT auto-send to the customer.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price_pence: { type: 'integer' },
            },
            required: ['description', 'quantity', 'unit_price_pence'],
          },
        },
        notes: { type: 'string' },
      },
      required: ['customer_id', 'line_items'],
    },
    dispatch: { kind: 'internal', fn: 'createEstimate' },
  },
  {
    name: 'log_action',
    description:
      'Record a value-adding action — used for ROI tracking. Use when you\'ve handled an enquiry, drafted a reply, or saved the owner time.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['message_handled', 'call_taken', 'booking_made', 'estimate_drafted', 'lead_qualified'],
        },
        summary: { type: 'string' },
        value_gbp: { type: 'number' },
        minutes_saved: { type: 'number' },
      },
      required: ['category', 'summary'],
    },
    dispatch: { kind: 'internal', fn: 'logAction' },
  },
]

/** Public — return tools matching the client's `enabled_tools` list. */
export function selectToolsForClient(enabledNames: string[] | null | undefined): ToolDefinition[] {
  if (!enabledNames || enabledNames.length === 0) {
    // Default: log_action + lookup_customer always available; integrations gated
    return ALL_TOOLS.filter((t) => t.dispatch.kind === 'internal' && (t.name === 'log_action' || t.name === 'lookup_customer'))
  }
  // Match by composio action id (uppercase) or tool name (lowercase)
  return ALL_TOOLS.filter((t) => {
    if (t.dispatch.kind === 'composio') return enabledNames.includes(t.dispatch.action)
    return enabledNames.includes(t.name)
  })
}

/** Find a tool by emitted name (Anthropic uses the `name` field). */
export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name)
}
