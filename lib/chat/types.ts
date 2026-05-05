// Chat types — match the prototype's shapes so the port is zero-friction.

export type Role = 'user' | 'assistant' | 'system';

export type MessageStatus = 'pending' | 'thinking' | 'drafting' | 'done' | 'error';

export type SourceType = 'contact' | 'call' | 'quote' | 'job' | 'invoice';

export interface Source {
  id: string;
  type: SourceType;
  label: string;
  sublabel?: string;
  details?: Record<string, unknown>;
}

export interface Breadcrumb {
  kind: 'tool' | 'info';
  label: string;
  ts?: string;
}

export interface Attachment {
  /** Short-lived signed URL (7-day TTL) for direct UI rendering. Re-mint
   * via supabase.storage.from('chat-attachments').createSignedUrl(path, ttl)
   * if expired — RLS grants the owning user SELECT on their client_id folder. */
  url: string;
  /** Storage path: <client_id>/<session_id>/<timestamp>-<safe-name>.
   * Persisted alongside `url` so the URL can be re-minted when expired
   * without round-tripping. Optional for legacy rows that pre-date the
   * 2026-04-30 privatisation migration. */
  path?: string;
  name: string;         // original filename
  mime: string;         // MIME type
  size: number;         // bytes
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'file';
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string; // ISO
  status: MessageStatus;
  sources?: Source[];
  errorMessage?: string;
  /** Streaming metadata written by the VPS bridge. */
  breadcrumbs?: Breadcrumb[];
  /** Files/images/videos the user attached to this message. */
  attachments?: Attachment[];
  /** Inline approval action proposed by the agent (B2). When present,
   * dashboard renders Approve/Reject buttons. Bridge parses agent's
   * ```action ...``` markdown fences against an allowlist (send_email,
   * send_invoice, book_calendar, send_sms) and writes here. */
  approval?: {
    type: 'approval';
    action: 'send_email' | 'send_invoice' | 'book_calendar' | 'send_sms';
    summary: string;
    payload: Record<string, unknown>;
  };
  /** Immediate predecessor in the conversation tree. Siblings with the
   * same parent_id are alternate branches — created when the user edits
   * a past message. UI: show most-recent sibling by default + switcher. */
  parentId?: string | null;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  messages: Message[];
  pinned?: boolean;
}

export interface Suggestion {
  prompt: string;
  category: string;
}

export interface Workflow {
  title: string;
  sub: string;
  steps: number;
  kind: string;
}

export interface Command {
  id: string;
  label: string;
  sub: string;
  icon: string;
}

export interface MentionCustomer {
  id: string;
  name: string;
  sub: string;
}
