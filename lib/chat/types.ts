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
  url: string;          // public Supabase storage URL
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
