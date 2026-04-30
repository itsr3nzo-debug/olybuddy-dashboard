/**
 * Stable API error contract — used by every /api/mobile/* route and shared
 * with /api/chat/* so the mobile app has one envelope to parse.
 *
 * The mobile client treats `code` as the source of truth (stable enum, never
 * reword) and `message` as fallback display text only. Adding a new code is
 * a non-breaking change; renaming or removing one is breaking — bump the
 * mobile minimum version if you must.
 */

export type ApiErrorCode =
  // auth
  | 'auth.invalid_token'
  | 'auth.expired_token'
  | 'auth.signed_out'
  | 'auth.email_not_verified'
  | 'auth.consent_required'
  // permissions
  | 'forbidden'
  | 'not_found'
  // request shape
  | 'validation.failed'
  | 'idempotency.conflict'
  | 'idempotency.replay_different_body'
  // throttling
  | 'rate_limit.exceeded'
  | 'budget.degraded'
  | 'budget.queue_for_approval'
  | 'budget.hard_capped'
  // upstreams
  | 'chat.upstream_error'
  | 'chat.idle_timeout'
  | 'chat.tool_error'
  | 'push.enroll_failed'
  | 'integration.provider_error'
  // generic
  | 'internal.unknown'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
  retryable: boolean
  retry_after_ms?: number
  request_id: string
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly retryable: boolean
  readonly details?: Record<string, unknown>
  readonly retryAfterMs?: number

  constructor(input: {
    code: ApiErrorCode
    status: number
    message: string
    retryable?: boolean
    details?: Record<string, unknown>
    retryAfterMs?: number
  }) {
    super(input.message)
    this.code = input.code
    this.status = input.status
    this.retryable = input.retryable ?? false
    this.details = input.details
    this.retryAfterMs = input.retryAfterMs
  }
}

// ----- Common throwers — keep call sites concise --------------------------

export const Errors = {
  invalidToken: () =>
    new ApiError({
      code: 'auth.invalid_token',
      status: 401,
      message: 'Token is invalid or malformed.',
      retryable: false,
    }),
  expiredToken: () =>
    new ApiError({
      code: 'auth.expired_token',
      status: 401,
      message: 'Token has expired. Refresh and retry.',
      retryable: true,
    }),
  signedOut: () =>
    new ApiError({
      code: 'auth.signed_out',
      status: 401,
      message: 'You are signed out on this device.',
      retryable: false,
    }),
  emailNotVerified: () =>
    new ApiError({
      code: 'auth.email_not_verified',
      status: 403,
      message: 'Verify your email address before continuing.',
      retryable: false,
    }),
  consentRequired: () =>
    new ApiError({
      code: 'auth.consent_required',
      status: 403,
      message: 'AI Employee consent required before this action.',
      retryable: false,
    }),
  forbidden: (msg = 'You do not have access to this resource.') =>
    new ApiError({ code: 'forbidden', status: 403, message: msg, retryable: false }),
  notFound: (msg = 'Resource not found.') =>
    new ApiError({ code: 'not_found', status: 404, message: msg, retryable: false }),
  validation: (details: Record<string, unknown>) =>
    new ApiError({
      code: 'validation.failed',
      status: 400,
      message: 'Request failed validation.',
      details,
      retryable: false,
    }),
  idempotencyConflict: () =>
    new ApiError({
      code: 'idempotency.conflict',
      status: 409,
      message: 'Idempotency key collision with a different user/endpoint.',
      retryable: false,
    }),
  idempotencyReplayDifferentBody: () =>
    new ApiError({
      code: 'idempotency.replay_different_body',
      status: 422,
      message: 'Idempotency-Key reused with a different request body.',
      retryable: false,
    }),
  rateLimited: (retryAfterMs: number) =>
    new ApiError({
      code: 'rate_limit.exceeded',
      status: 429,
      message: 'Too many requests. Slow down.',
      retryable: true,
      retryAfterMs,
    }),
  budgetDegraded: () =>
    new ApiError({
      code: 'budget.degraded',
      status: 200, // soft — not an error from the client's POV, model just downshifted
      message: 'Cost ceiling approaching — replies are running on a lighter model.',
      retryable: false,
    }),
  budgetQueueForApproval: () =>
    new ApiError({
      code: 'budget.queue_for_approval',
      status: 202,
      message: 'Reply queued for owner approval before sending.',
      retryable: false,
    }),
  budgetHardCapped: () =>
    new ApiError({
      code: 'budget.hard_capped',
      status: 402,
      message: 'AI Employee paused — usage cap reached. Contact support.',
      retryable: false,
    }),
  chatUpstream: (err: unknown) =>
    new ApiError({
      code: 'chat.upstream_error',
      status: 502,
      message: err instanceof Error ? err.message : 'Upstream model error.',
      retryable: true,
    }),
  chatIdleTimeout: () =>
    new ApiError({
      code: 'chat.idle_timeout',
      status: 504,
      message: 'Model went silent — try again.',
      retryable: true,
    }),
  pushEnrollFailed: (msg: string) =>
    new ApiError({
      code: 'push.enroll_failed',
      status: 502,
      message: msg,
      retryable: true,
    }),
  internal: (msg = 'Something went wrong on our side.') =>
    new ApiError({
      code: 'internal.unknown',
      status: 500,
      message: msg,
      retryable: true,
    }),
}

// ----- Response builder ----------------------------------------------------

export function errorResponse(err: unknown, requestId: string): Response {
  const apiErr = err instanceof ApiError ? err : Errors.internal()
  const body: ApiErrorBody = {
    code: apiErr.code,
    message: apiErr.message,
    details: apiErr.details,
    retryable: apiErr.retryable,
    retry_after_ms: apiErr.retryAfterMs,
    request_id: requestId,
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
  }
  if (apiErr.retryAfterMs) {
    headers['Retry-After'] = Math.ceil(apiErr.retryAfterMs / 1000).toString()
  }
  // Log internal errors at server side; user gets sanitized message
  if (!(err instanceof ApiError)) {
    console.error(`[api-error] ${requestId}`, err)
  }
  return new Response(JSON.stringify(body), {
    status: apiErr.status,
    headers,
  })
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; requestId: string }
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': init.requestId,
      ...(init.headers ?? {}),
    },
  })
}

export function newRequestId(): string {
  // Cheap UUIDv4 — avoids a crypto import path mismatch between Edge/Node runtimes
  // (crypto.randomUUID is in both since Node 19, but Vercel Edge sometimes lags)
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  )
}
