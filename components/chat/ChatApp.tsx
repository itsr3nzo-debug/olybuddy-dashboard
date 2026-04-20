"use client";

/**
 * ChatApp — Nexley chat orchestrator.
 *
 * Port of the prototype's `app.jsx`, now wired to real Supabase data:
 *   - Loads sessions from `/api/chat/sessions` on mount.
 *   - Loads messages on session select from `/api/chat/sessions/:id`.
 *   - POSTs to `/api/chat/messages` when the user sends.
 *   - Subscribes to Supabase Realtime for the active session and merges
 *     message INSERT/UPDATE events into local state.
 *
 * Streaming UI is driven by status transitions written by the VPS bridge
 * (pending → thinking → drafting → done), NOT by a setTimeout tick.
 *
 * When the user has no sessions yet, we show the empty-state Dashboard
 * plus the prototype's SEED_SESSIONS as a demo-preview at the bottom of
 * the sidebar. New messages always create real sessions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { cx } from '@/lib/chat/utils';
import { SUGGESTIONS, WORKFLOWS } from '@/lib/chat/mock';
import type { Message, Session, Source } from '@/lib/chat/types';
import { listSessions, loadSession, postMessage, renameSession as apiRenameSession, rowToMessage, summaryToSession } from '@/lib/chat/api';
import { useChatRealtime } from '@/lib/chat/useChatRealtime';
import { ClientContextProvider } from '@/lib/chat/client-context';
import Sidebar from './Sidebar';
import Dashboard from './Features';
import { AssistPanel, ReplyCanvas } from './Views';
import { SourceSlideOver, CommandPalette, MentionMenu } from './Overlays';

interface ChatAppProps {
  /** Current signed-in user's client_id — surfaced so the UI can scope queries. */
  clientId: string;
  /** Business name shown in brand / greeting. */
  clientName: string;
  /** Current user email — shown in the footer. */
  userEmail: string;
  /** Optional owner display name for greetings. */
  ownerName?: string;
  /** True when a super_admin is viewing the chat — shows an admin banner + "switch client" link. */
  isAdminView?: boolean;
}

export default function ChatApp(props: ChatAppProps) {
  // Theme ─────────────────────────────────────────────────────────────
  // Use the dashboard's next-themes provider so the chat honors the same
  // toggle as the rest of the dashboard. resolvedTheme is undefined during
  // SSR / first client render to avoid hydration mismatch.
  const { resolvedTheme, setTheme: setNextTheme } = useTheme();
  const theme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';

  // Sessions ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let alive = true;
    listSessions(props.clientId)
      .then((summaries) => {
        if (!alive) return;
        setSessions(summaries.map((s) => summaryToSession(s)));
        setSessionsLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSessionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [props.clientId]);

  // When we activate a session, lazy-load its full message list
  useEffect(() => {
    if (!currentSessionId) return;
    const existing = sessions.find((s) => s.id === currentSessionId);
    if (existing && existing.messages.length > 0) return;

    let alive = true;
    loadSession(currentSessionId, props.clientId)
      .then((res) => {
        if (!alive || !res) return;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSessionId ? { ...s, title: res.session.title, messages: res.messages } : s
          )
        );
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [currentSessionId, sessions]);

  // Overlays ──────────────────────────────────────────────────────────
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);

  // Sidebar + resize state ────────────────────────────────────────────
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const [assistWidth, setAssistWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 400;
    try {
      return parseInt(localStorage.getItem('hy-assist-w') || '400', 10);
    } catch {
      return 400;
    }
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const sidebar = sbCollapsed ? 56 : 200;
      const w = Math.max(320, Math.min(560, e.clientX - sidebar));
      setAssistWidth(w);
    };
    const onUp = () => setResizing(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, sbCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem('hy-assist-w', String(assistWidth));
    } catch {
      // ignore
    }
  }, [assistWidth]);

  // Busy state — true while a reply is in-flight
  const [busy, setBusy] = useState(false);

  // streamingText is derived: when an assistant message is 'drafting', its
  // content field IS the partial text. The prototype's separate streamingText
  // state is no longer needed (realtime pushes content updates directly).
  const streamingText = '';

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  // Realtime ──────────────────────────────────────────────────────────
  const applyRealtime = useCallback((msg: Message, kind: 'insert' | 'update') => {
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== currentSessionIdRef.current) return s;
        const idx = s.messages.findIndex((m) => m.id === msg.id);
        if (idx === -1 && kind === 'insert') {
          changed = true;
          return { ...s, messages: [...s.messages, msg] };
        }
        if (idx >= 0) {
          changed = true;
          const messages = s.messages.slice();
          messages[idx] = { ...messages[idx], ...msg };
          return { ...s, messages };
        }
        return s;
      });
      if (!changed) return prev;
      // If the assistant message transitioned to done/error, stop showing busy.
      if (msg.role === 'assistant' && (msg.status === 'done' || msg.status === 'error')) {
        setBusy(false);
      }
      return next;
    });
  }, []);

  const currentSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useChatRealtime(currentSessionId, applyRealtime);

  // Actions ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setBusy(true);
      try {
        const res = await postMessage(content, currentSessionId, props.clientId);
        const userMsg = rowToMessage({
          id: res.user_message.id,
          role: 'user',
          content: res.user_message.content,
          status: 'done',
          created_at: res.user_message.createdAt,
        });
        const asstMsg = rowToMessage({
          id: res.assistant_message.id,
          role: 'assistant',
          content: '',
          status: 'pending',
          created_at: res.assistant_message.createdAt,
        });

        setSessions((prev) => {
          const existingIdx = prev.findIndex((s) => s.id === res.session_id);
          if (existingIdx >= 0) {
            const next = prev.slice();
            const s = next[existingIdx];
            next[existingIdx] = {
              ...s,
              messages: [...s.messages, userMsg, asstMsg],
              updatedAt: new Date().toISOString(),
            };
            return next;
          }
          // New session — create it at top
          const newSess: Session = {
            id: res.session_id,
            title: content.length > 48 ? content.slice(0, 48) + '…' : content,
            createdAt: userMsg.createdAt,
            updatedAt: new Date().toISOString(),
            messages: [userMsg, asstMsg],
          };
          return [newSess, ...prev];
        });
        if (!currentSessionId) setCurrentSessionId(res.session_id);
      } catch {
        setBusy(false);
      }
    },
    [busy, currentSessionId]
  );

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const selectSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    apiRenameSession(id, title).catch(() => {
      /* silently fail — DA says don't hassle the user for a label change */
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setNextTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setNextTheme, theme]);

  // Global keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newChat();
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        setSbCollapsed((c) => !c);
      } else if (mod && e.key === '.') {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, toggleTheme]);

  // Stuck-pending sweeper ─────────────────────────────────────────────
  // If an assistant message has been pending/thinking/drafting for >120s,
  // the bridge is either down, blocked, or timed out. Locally mark it as
  // errored so the UI stops spinning. (DB row may still update later;
  // realtime will overwrite.)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setSessions((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          const messages = s.messages.map((m) => {
            if (
              m.role === 'assistant' &&
              (m.status === 'pending' || m.status === 'thinking' || m.status === 'drafting') &&
              now - new Date(m.createdAt).getTime() > 120_000
            ) {
              changed = true;
              return {
                ...m,
                status: 'error' as const,
                errorMessage: 'Took too long to reply — try again.',
              };
            }
            return m;
          });
          return changed ? { ...s, messages } : s;
        });
        return changed ? next : prev;
      });
      setBusy((b) => {
        // If nothing is actually in flight, release busy
        const activeSess = sessions.find((s) => s.id === currentSessionIdRef.current);
        const stillInFlight = activeSess?.messages.some(
          (m) =>
            m.role === 'assistant' &&
            (m.status === 'pending' || m.status === 'thinking' || m.status === 'drafting') &&
            now - new Date(m.createdAt).getTime() < 120_000
        );
        return stillInFlight ? b : false;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [sessions]);

  // Render ────────────────────────────────────────────────────────────
  void sessionsLoading;

  return (
    <ClientContextProvider
      value={{
        clientId: props.clientId,
        clientName: props.clientName,
        userEmail: props.userEmail,
        ownerName: props.ownerName,
      }}
    ><div className={cx('nexley-chat-root flex flex-col h-full w-full overflow-hidden bg-app', theme)}>
      {props.isAdminView && (
        <div className="flex items-center gap-3 px-4 py-2 text-[12px] border-b-hy bg-subtle fg-subtle flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-hover px-2 py-0.5 text-[11px] fg-base">
            Admin view
          </span>
          <span className="truncate">
            Chatting as <strong className="fg-base">{props.clientName}</strong>&apos;s AI Employee. All messages hit the live client agent.
          </span>
          <a href="/chat" className="ml-auto fg-base underline underline-offset-2 hover:opacity-80">Switch client</a>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={selectSession}
        onNewChat={newChat}
        onOpenPalette={() => setPaletteOpen(true)}
        onToggleTheme={toggleTheme}
        theme={theme}
        collapsed={sbCollapsed}
        onToggleCollapse={() => setSbCollapsed((c) => !c)}
        onGoHome={newChat}
      />

      {!currentSession ? (
        <main className="flex-1 min-w-0 bg-app">
          <Dashboard
            suggestions={SUGGESTIONS}
            workflows={WORKFLOWS}
            onSend={sendMessage}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenMention={() => setMentionOpen(true)}
          />
        </main>
      ) : (
        <>
          <div style={{ width: assistWidth, flexShrink: 0 }} className="border-r-hy min-w-0">
            <AssistPanel
              session={currentSession}
              onSend={sendMessage}
              onOpenSource={setOpenSource}
              streamingText={streamingText}
              busy={busy}
              onRenameSession={renameSession}
              onOpenMention={() => setMentionOpen(true)}
              onOpenPalette={() => setPaletteOpen(true)}
            />
          </div>
          <div className={cx('resizer', resizing && 'active')} onMouseDown={() => setResizing(true)} />
          <div className="flex-1 min-w-0">
            <ReplyCanvas
              session={currentSession}
              streamingText={streamingText}
              onOpenSource={setOpenSource}
              onBackToDashboard={newChat}
            />
          </div>
        </>
      )}
      </div>{/* /.flex flex-1 min-h-0 */}

      {/* Overlays */}
      {openSource && <SourceSlideOver source={openSource} onClose={() => setOpenSource(null)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sessions={sessions}
        onSelectSession={selectSession}
        onNewChat={newChat}
        onToggleTheme={toggleTheme}
        onSend={sendMessage}
      />
      <MentionMenu
        open={mentionOpen}
        onClose={() => setMentionOpen(false)}
        onPick={() => {
          /* future: inject @mention into active composer */
        }}
      />
    </div>
    </ClientContextProvider>
  );
}
