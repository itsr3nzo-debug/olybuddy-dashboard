"use client";

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { relativeTime } from '@/lib/chat/utils';

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string;
  pinned?: boolean;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
}

/**
 * Read-only live view of an admin's observed client. Subscribes to the
 * latest selected session's messages. Never exposes a composer.
 */
export default function ShadowChatView({
  clientId,
  initialSessions,
}: {
  clientId: string;
  initialSessions: SessionRow[];
}) {
  const [sessions] = useState<SessionRow[]>(initialSessions);
  const [activeId, setActiveId] = useState<string | null>(initialSessions[0]?.id ?? null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Load messages for active session
  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from('agent_chat_messages')
      .select('id, role, content, status, created_at, completed_at')
      .eq('session_id', activeId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages((data ?? []) as MessageRow[]);
        setLoading(false);
      });
  }, [activeId]);

  // Realtime stream on active session
  useEffect(() => {
    if (!activeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`shadow:${activeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_chat_messages',
          filter: `session_id=eq.${activeId}`,
        },
        (payload) => {
          setMessages((prev) => {
            const row = (payload.new ?? payload.old) as MessageRow;
            const existing = prev.findIndex((m) => m.id === row.id);
            if (payload.eventType === 'INSERT') {
              if (existing >= 0) return prev;
              return [...prev, row];
            }
            if (payload.eventType === 'UPDATE' && existing >= 0) {
              const copy = prev.slice();
              copy[existing] = { ...copy[existing], ...row };
              return copy;
            }
            if (payload.eventType === 'DELETE' && existing >= 0) {
              return prev.filter((m) => m.id !== row.id);
            }
            return prev;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[480px]">
      {/* Sessions list */}
      <aside className="rounded-md border border-border bg-card p-2 overflow-y-auto">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground px-2 py-1.5">Sessions</h3>
        {sessions.length === 0 && <p className="text-xs text-muted-foreground px-2 py-2">No sessions yet.</p>}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={
              'w-full text-left px-2 py-1.5 rounded text-sm truncate transition-colors ' +
              (activeId === s.id
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')
            }
          >
            <div className="truncate">{s.title || 'Untitled'}</div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {s.updated_at ? relativeTime(s.updated_at) : relativeTime(s.created_at)}
            </div>
          </button>
        ))}
      </aside>

      {/* Messages pane */}
      <section className="rounded-md border border-border bg-card p-4 overflow-y-auto flex flex-col gap-4">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages in this session yet.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-[11px] text-muted-foreground">
              <span className={m.role === 'assistant' ? 'font-medium text-foreground' : ''}>
                {m.role === 'user' ? 'Owner' : m.role === 'assistant' ? 'Agent' : m.role}
              </span>
              <span className="mx-1.5">·</span>
              <time className="font-mono">{relativeTime(m.created_at)}</time>
              {m.status !== 'done' && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className="italic">{m.status}</span>
                </>
              )}
            </div>
            <div
              className={
                m.role === 'user'
                  ? 'rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] self-end'
                  : 'text-sm whitespace-pre-wrap max-w-[95%] leading-relaxed'
              }
            >
              {m.content || (m.status !== 'done' ? <span className="text-muted-foreground">(streaming…)</span> : '(empty)')}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
