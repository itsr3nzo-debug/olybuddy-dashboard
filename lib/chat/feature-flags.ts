/**
 * Dashboard chat feature flags.
 *
 * Single source of truth — flip these and redeploy. Used by both the
 * /chat page (UI render) AND the API routes (POST /messages, POST
 * /sessions) so a cached/stale frontend tab can't bypass the kill-switch
 * by hitting the API directly.
 */

/**
 * Kill-switch for the dashboard chat. When true:
 *   - /chat renders a "temporarily down" card for every role
 *   - POST /api/chat/messages refuses with 503
 *   - POST /api/chat/sessions refuses with 503
 *
 * Reads/PATCH/DELETE on existing sessions stay open so users can still
 * see their history.
 *
 * Toggle: flip to false, commit, push, redeploy.
 */
export const CHAT_TEMPORARILY_DISABLED = false;

export const CHAT_DISABLED_MESSAGE =
  'The dashboard chat is paused for maintenance. We’ll have it back online shortly.';
