import type { Session, Message } from './types';

export interface SessionSummary {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at?: string;
}

export async function listSessions(clientId?: string): Promise<SessionSummary[]> {
  const qs = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
  const res = await fetch(`/api/chat/sessions${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('listSessions failed');
  const body = await res.json();
  return body.sessions ?? [];
}

export async function loadSession(
  id: string,
  clientId?: string
): Promise<{ session: SessionSummary; messages: Message[] } | null> {
  const qs = clientId ? `?client=${encodeURIComponent(clientId)}` : '';
  const res = await fetch(`/api/chat/sessions/${id}${qs}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('loadSession failed');
  const body = await res.json();
  // API returns raw DB rows (snake_case); normalise via rowToMessage so the
  // UI gets createdAt / errorMessage / breadcrumbs instead of undefined.
  const rawRows = (body.messages ?? []) as Array<Parameters<typeof rowToMessage>[0]>;
  return { session: body.session, messages: rawRows.map(rowToMessage) };
}

export async function createSession(title?: string, clientId?: string): Promise<SessionSummary> {
  const res = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, client_id: clientId }),
  });
  if (!res.ok) throw new Error('createSession failed');
  const body = await res.json();
  return body.session;
}

export async function renameSession(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('renameSession failed');
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('deleteSession failed');
}

export async function pinSession(id: string, pinned: boolean): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  });
  if (!res.ok) throw new Error('pinSession failed');
}

export interface PostMessageResult {
  session_id: string;
  user_message: Message;
  assistant_message: Message;
}

// tiny RFC4122 v4 generator — only used for idempotency keys, no need for a full uuid dep
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function postMessage(
  content: string,
  session_id: string | null,
  clientId?: string,
  attachments?: Message['attachments'],
  parentId?: string | null,
): Promise<PostMessageResult> {
  // Idempotency — if this same fetch retries (browser retry / connection
  // blip / user double-send), the server returns the first response
  // rather than creating duplicate messages. Valid for 24h.
  const idempotencyKey = randomUuid();
  const res = await fetch('/api/chat/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      content,
      session_id: session_id ?? undefined,
      create_if_missing: !session_id,
      // Always pass client_id — server ignores it for non-admins (pinned to JWT)
      // and uses it for super_admins to scope their chat into the right tenant.
      client_id: clientId,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      // When the user edits a past message and re-sends, pass parent_id =
      // the edited message's parent so the new row becomes a SIBLING of
      // the original rather than tacked onto the end.
      parent_id: parentId ?? undefined,
    }),
  });
  if (!res.ok) {
    // Try to surface the server's error message (rate-limited, payload
    // too large, etc.) so the UI can show something useful instead of
    // the generic "postMessage failed". Fall back to the generic if the
    // body isn't JSON.
    let serverMsg: string | null = null;
    try {
      const errBody = await res.json();
      serverMsg = typeof errBody?.message === 'string' ? errBody.message
        : typeof errBody?.error === 'string' ? errBody.error
        : null;
    } catch { /* non-JSON response */ }
    const err = new Error(serverMsg || 'postMessage failed') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

/**
 * Map a row from the API / realtime into our Message type.
 * The DB column names are snake_case; our types use camelCase.
 */
export function rowToMessage(row: {
  id: string;
  role: string;
  content: string;
  status: string;
  sources?: Message['sources'];
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
  metadata?: {
    breadcrumbs?: Message['breadcrumbs'];
    attachments?: Message['attachments'];
    approval?: Message['approval'];
  } | null;
  parent_id?: string | null;
}): Message {
  return {
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    status: row.status as Message['status'],
    sources: row.sources ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    breadcrumbs: row.metadata?.breadcrumbs ?? undefined,
    attachments: row.metadata?.attachments ?? undefined,
    approval: row.metadata?.approval ?? undefined,
    parentId: row.parent_id ?? null,
  };
}

export function summaryToSession(sum: SessionSummary, messages: Message[] = []): Session {
  return {
    id: sum.id,
    title: sum.title,
    createdAt: sum.created_at,
    updatedAt: sum.updated_at,
    messages,
    pinned: sum.pinned,
  };
}
