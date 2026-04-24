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
import { AlertCircle } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cx } from '@/lib/chat/utils';
import { SUGGESTIONS, WORKFLOWS } from '@/lib/chat/mock';
import type { Message, Session, Source } from '@/lib/chat/types';
import { listSessions, loadSession, postMessage, renameSession as apiRenameSession, deleteSession as apiDeleteSession, pinSession as apiPinSession, rowToMessage, summaryToSession } from '@/lib/chat/api';
import { useChatRealtime, type RealtimeStatus } from '@/lib/chat/useChatRealtime';
import { ClientContextProvider } from '@/lib/chat/client-context';
import Sidebar, { type ChatView } from './Sidebar';
import Dashboard from './Features';
import { AssistPanel } from './Views';
import { CustomersView, VaultView, WorkflowsView, HistoryView, KnowledgeView } from './TabViews';
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
  // toggle as the rest of the dashboard. resolvedTheme is undefined on the
  // server and during the first client render — if we wrote the class at
  // that moment we'd get a hydration mismatch when next-themes swaps in the
  // real theme from localStorage. `mounted` gates theme-dependent output to
  // client-only. We also suppressHydrationWarning on the root div so the
  // one-frame flash of classless output doesn't trip React.
  const { resolvedTheme, setTheme: setNextTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const theme: 'light' | 'dark' = mounted && resolvedTheme === 'dark' ? 'dark' : 'light';

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

  // Track which session IDs are currently fetching messages — lets
  // AssistPanel show a skeleton instead of an empty scroll area while
  // loadSession is in flight. Reset once the messages land (or fail).
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set());

  // When we activate a session, lazy-load its full message list
  useEffect(() => {
    if (!currentSessionId) return;
    const existing = sessions.find((s) => s.id === currentSessionId);
    if (existing && existing.messages.length > 0) return;
    const sessionId = currentSessionId; // pin for closure so showError references the right id

    let alive = true;
    setLoadingSessions((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    loadSession(sessionId, props.clientId)
      .then((res) => {
        if (!alive) return;
        if (!res) {
          // 404 — the session was deleted (or was never ours). Surface it so
          // the user isn\u2019t staring at a blank scroll area forever, and
          // drop the dead reference from local state + active selection.
          showError('That chat couldn\u2019t be found. It may have been deleted.');
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          if (currentSessionIdRef.current === sessionId) setCurrentSessionId(null);
          return;
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, title: res.session.title, messages: res.messages } : s
          )
        );
      })
      .catch(() => {
        if (!alive) return;
        showError('Couldn\u2019t load that chat. Check your connection and try again.');
      })
      .finally(() => {
        if (!alive) return;
        setLoadingSessions((prev) => {
          if (!prev.has(sessionId)) return prev;
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      });
    return () => {
      alive = false;
    };
    // `showError` is stable via useCallback; `sessions` is intentionally
    // omitted to avoid re-running on every message merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, props.clientId]);

  // Overlays ──────────────────────────────────────────────────────────
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [pendingMention, setPendingMention] = useState<string | null>(null);

  // Sidebar state ────────────────────────────────────────────
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<ChatView>('assistant');

  // Busy state — true while a reply is in-flight
  const [busy, setBusy] = useState(false);

  // Ephemeral error banner — surfaces API failures (send / rename / pin /
  // delete). Auto-dismisses after 6s; the `key` forces re-mount so a second
  // error while the first is still visible re-triggers the animation + timer.
  const [errorBanner, setErrorBanner] = useState<{ key: number; message: string } | null>(null);
  const showError = useCallback((message: string) => {
    setErrorBanner({ key: Date.now(), message });
  }, []);
  useEffect(() => {
    if (!errorBanner) return;
    const t = setTimeout(() => setErrorBanner(null), 6000);
    return () => clearTimeout(t);
  }, [errorBanner]);

  // Realtime connection status — shown as a subtle "reconnecting" pill on
  // the active conversation header when the websocket drops AND we have an
  // in-flight message. `idle` is the initial state before a session is
  // selected; we only show the indicator for `error` / `closed`.
  const [rtStatus, setRtStatus] = useState<RealtimeStatus>('idle');

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  // Realtime ──────────────────────────────────────────────────────────
  // Track the last time a realtime event actually fired. The polling fallback
  // skips its DB hit when realtime is healthy (event in the last 5s) so we're
  // not running 24 GETs/minute per active chat for no reason.
  const lastRealtimeAtRef = useRef<number>(0);
  const applyRealtime = useCallback((msg: Message, kind: 'insert' | 'update') => {
    lastRealtimeAtRef.current = Date.now();
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

  useChatRealtime(currentSessionId, applyRealtime, setRtStatus);

  // Polling fallback — realtime websocket respects RLS and admin JWTs can
  // occasionally miss events. Every 2.5s, while the active session has at
  // least one in-flight assistant message AND realtime has been quiet for
  // more than 5s, re-fetch messages via the API (which uses service-role
  // for admin reads) and reconcile into state. Healthy realtime bypasses
  // the poll entirely.
  useEffect(() => {
    if (!currentSessionId) return;
    const poll = async () => {
      const inFlight = sessionsRef.current
        .find((s) => s.id === currentSessionIdRef.current)?.messages
        .some((m) =>
          m.role === 'assistant' && (m.status === 'pending' || m.status === 'thinking' || m.status === 'drafting')
        );
      if (!inFlight) return;
      // Realtime quiet-period gate — if we got an event recently, trust it.
      const since = Date.now() - lastRealtimeAtRef.current;
      if (since < 5000) return;
      const res = await loadSession(currentSessionId, props.clientId).catch(() => null);
      if (!res) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          // Merge — preserve local state so poll doesn't regress live
          // progress. Realtime is usually ahead of poll; if poll fetches
          // an older DB snapshot while realtime has already pushed the
          // next status, we don't want to clobber forward with stale.
          const byId = new Map(res.messages.map((m) => [m.id, m]));
          // Ordered status ranks — higher = more complete. Never allow a
          // merge to move a message BACKWARDS along this chain.
          const rank: Record<string, number> = {
            pending: 1,
            thinking: 2,
            drafting: 3,
            done: 4,
            error: 4,
          };
          const merged = s.messages.map((m) => {
            const dbMsg = byId.get(m.id);
            if (!dbMsg) return m;
            // Preserve local error state — sweeper-set error shouldn't be
            // overwritten by a stale DB pending/thinking row.
            if (m.status === 'error' && (dbMsg.status === 'pending' || dbMsg.status === 'thinking')) return m;
            // Never regress: if local is ahead of DB in the status chain,
            // keep local (except we DO accept db content edits via merge).
            const localRank = rank[m.status] ?? 0;
            const dbRank = rank[dbMsg.status] ?? 0;
            if (dbRank < localRank) {
              // DB is stale — keep local status but accept any richer
              // fields that the DB has and local doesn't (e.g. breadcrumbs).
              return {
                ...m,
                breadcrumbs: dbMsg.breadcrumbs ?? m.breadcrumbs,
                sources: dbMsg.sources ?? m.sources,
              };
            }
            return dbMsg;
          });
          const seen = new Set(s.messages.map((m) => m.id));
          for (const m of res.messages) if (!seen.has(m.id)) merged.push(m);
          return { ...s, messages: merged };
        })
      );
    };
    const interval = setInterval(poll, 2500);
    return () => clearInterval(interval);
  }, [currentSessionId, props.clientId]);

  // Actions ───────────────────────────────────────────────────────────
  // In admin (super_admin) view we confirm ONCE per tab that the user
  // intends to send to THIS client's agent. Prevents the "two tabs open,
  // typed into the wrong one" footgun.
  const adminConfirmedRef = useRef(false);
  // sendMessage returns a boolean so the Composer can decide whether to
  // clear its local text — on failure we want to preserve what the user
  // typed so they don't have to re-enter it.
  const sendMessage = useCallback(
    async (text: string, attachments?: import('@/lib/chat/types').Attachment[]): Promise<boolean> => {
      const content = text.trim();
      const hasAtt = !!(attachments && attachments.length);
      if ((!content && !hasAtt) || busy) return false;
      // Admin cross-tenant safety — first send in an admin view triggers a
      // confirm dialog that names the client. After the user confirms
      // once, subsequent sends in the same tab go through unhindered.
      if (props.isAdminView && !adminConfirmedRef.current) {
        const ok = typeof window !== 'undefined' && window.confirm(
          `You're about to send a message to ${props.clientName}'s live AI Employee. The client can see this in their own chat. Continue?`,
        );
        if (!ok) return false;
        adminConfirmedRef.current = true;
      }
      setBusy(true);
      try {
        const res = await postMessage(content, currentSessionId, props.clientId, attachments);
        // API returns raw DB rows (snake_case). Normalise to Message shape.
        const u = res.user_message as unknown as { id: string; content: string; created_at?: string; createdAt?: string; metadata?: { attachments?: import('@/lib/chat/types').Attachment[] } };
        const a = res.assistant_message as unknown as { id: string; created_at?: string; createdAt?: string };
        const nowIso = new Date().toISOString();
        const userMsg = rowToMessage({
          id: u.id,
          role: 'user',
          content: u.content,
          status: 'done',
          created_at: u.created_at || u.createdAt || nowIso,
          metadata: u.metadata ?? (hasAtt ? { attachments } : undefined),
        });
        const asstMsg = rowToMessage({
          id: a.id,
          role: 'assistant',
          content: '',
          status: 'pending',
          created_at: a.created_at || a.createdAt || nowIso,
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
        return true;
      } catch (err) {
        // Surface the failure so the user knows their message didn't land —
        // previously this was silent, leaving them staring at an idle
        // composer with no indication the send failed.
        setBusy(false);
        const detail = err instanceof Error ? err.message : 'Couldn\u2019t send';
        showError(
          detail.includes('failed')
            ? 'Couldn\u2019t send that message. Check your connection and try again.'
            : detail
        );
        return false;
      }
    },
    [busy, currentSessionId, showError, props.clientId, props.isAdminView, props.clientName]
  );

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
    setActiveView('assistant');
    // Releasing `busy` here is the safe default — the previous session's
    // in-flight reply, if any, will finish writing into Supabase regardless
    // (the bridge doesn't care about the dashboard's local `busy` state).
    // Leaving busy=true on switch traps the Composer in "disabled" limbo.
    setBusy(false);
  }, []);

  const selectSession = useCallback((id: string) => {
    setCurrentSessionId(id);
    setActiveView('assistant');
    setBusy(false); // same reason as newChat — don't leak busy across sessions
  }, []);

  // Retry an errored assistant reply. Finds the preceding user message in
  // the same session, resends its content. We don't delete the errored
  // row — it stays in place as a record that the first attempt failed, but
  // the new user+assistant pair appears below with a fresh attempt.
  // Falls through to a visible error if no preceding user message is
  // available (shouldn\u2019t normally happen, but state corruption or a
  // partially-replayed session could cause it — silent no-op would look
  // like a broken button).
  const retryMessage = useCallback((erroredAssistantId: string) => {
    if (!currentSessionId) {
      showError('Can\u2019t retry without an active chat.');
      return;
    }
    const sess = sessions.find(s => s.id === currentSessionId);
    if (!sess) {
      showError('Chat is no longer available. Refresh and try again.');
      return;
    }
    const idx = sess.messages.findIndex(m => m.id === erroredAssistantId);
    if (idx <= 0) {
      showError('Can\u2019t find the original question to retry.');
      return;
    }
    // Walk backwards to find the most recent user message before the error.
    for (let i = idx - 1; i >= 0; i--) {
      const m = sess.messages[i];
      if (m.role === 'user' && m.content) {
        // Attachment URLs are signed with ~24h expiry. If this message is
        // older than that, the URLs will 404 on retry. Warn the user so
        // they know the retry won't include the original files; send the
        // text-only version instead.
        const ageMs = Date.now() - new Date(m.createdAt).getTime();
        const hasAttachments = (m.attachments?.length ?? 0) > 0;
        const URL_EXPIRY_MS = 23 * 60 * 60 * 1000; // 23h — one hour of safety margin
        if (hasAttachments && ageMs > URL_EXPIRY_MS) {
          showError('Original attachment links have expired. Re-upload the files and try again.');
          void sendMessage(m.content); // send without the stale attachments
        } else {
          void sendMessage(m.content, m.attachments);
        }
        return;
      }
    }
    showError('Can\u2019t find the original question to retry.');
  }, [currentSessionId, sessions, showError]);  // eslint-disable-line react-hooks/exhaustive-deps

  const navChange = useCallback((view: ChatView) => {
    setActiveView(view);
    if (view !== 'assistant') setCurrentSessionId(null);
  }, []);

  // Mobile WhatsApp-style drill-down: below the lg breakpoint we show EITHER
  // the session list (Sidebar) OR the active conversation/tab (main), never
  // both. On desktop (>= lg) both panes render side-by-side as before.
  //
  // Rules:
  //   - showMain: a session is active, OR the user picked a non-assistant
  //     tab (vault/workflows/history/knowledge). Hides sidebar on mobile.
  //   - showSidebar: the inverse — assistant view with no active session.
  //
  // A mobile-only "back" chevron at the top of main pops back to the list
  // by clearing currentSessionId + resetting to assistant view.
  const showMain = !!currentSessionId || activeView !== 'assistant';
  const handleMobileBack = useCallback(() => {
    setCurrentSessionId(null);
    setActiveView('assistant');
    // Clear any armed @mention so it doesn\u2019t leak into the next session\u2019s
    // composer — previously the mention prefix stayed "pending" across the
    // drill-down and got auto-injected when the user landed on another chat.
    setPendingMention(null);
    setMentionOpen(false);
  }, []);

  // Each of these three optimistically updates local state, fires the API
  // call, and rolls back on failure. Previously they all silently swallowed
  // errors — which left the UI in a lying state (e.g. a rename looked
  // successful while the DB still had the old title).
  const renameSession = useCallback((id: string, title: string) => {
    let previousTitle: string | undefined;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      previousTitle = s.title;
      return { ...s, title };
    }));
    apiRenameSession(id, title).catch(() => {
      // Roll back to the previous title so the UI reflects reality.
      if (previousTitle !== undefined) {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: previousTitle! } : s)));
      }
      showError('Couldn\u2019t rename that chat. Try again.');
    });
  }, [showError]);

  const deleteSession = useCallback((id: string) => {
    let removed: Session | undefined;
    let removedIdx = -1;
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      removed = prev[idx];
      removedIdx = idx;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    const wasActive = currentSessionId === id;
    if (wasActive) setCurrentSessionId(null);
    apiDeleteSession(id).catch(() => {
      // Put it back where it was, preserving order, and re-select if needed.
      if (removed) {
        setSessions((prev) => {
          const next = prev.slice();
          next.splice(Math.min(removedIdx, next.length), 0, removed!);
          return next;
        });
        if (wasActive) setCurrentSessionId(id);
      }
      showError('Couldn\u2019t delete that chat. Try again.');
    });
  }, [currentSessionId, showError]);

  const pinSession = useCallback((id: string, pinned: boolean) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned } : s)));
    apiPinSession(id, pinned).catch(() => {
      // Revert the pin toggle.
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned: !pinned } : s)));
      showError(pinned ? 'Couldn\u2019t pin that chat.' : 'Couldn\u2019t unpin that chat.');
    });
  }, [showError]);

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
  // Tiered timeouts — `pending` beyond 25s becomes an error (bridge never
  // picked up), `thinking`/`drafting` beyond 120s becomes an error (slow
  // reply). Uses `setSessions` functional form so it stays correct without
  // depending on `sessions` (which would re-mount the interval on every
  // realtime update and prevent it from ever firing).
  const sessionsRef = useRef<Session[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setSessions((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          const messages = s.messages.map((m) => {
            if (m.role !== 'assistant') return m;
            const ageMs = now - new Date(m.createdAt).getTime();
            if (m.status === 'pending' && ageMs > 25_000) {
              changed = true;
              return {
                ...m,
                status: 'error' as const,
                errorMessage:
                  'Didn\u2019t reach your AI Employee. It may be offline — try again in a moment.',
              };
            }
            if ((m.status === 'thinking' || m.status === 'drafting') && ageMs > 120_000) {
              changed = true;
              return {
                ...m,
                status: 'error' as const,
                errorMessage: 'Your AI Employee took too long to reply. Give it another go.',
              };
            }
            return m;
          });
          return changed ? { ...s, messages } : s;
        });
        return changed ? next : prev;
      });
      // Release busy if nothing is in-flight in the active session
      const activeSess = sessionsRef.current.find((s) => s.id === currentSessionIdRef.current);
      const stillInFlight = activeSess?.messages.some(
        (m) =>
          m.role === 'assistant' &&
          (m.status === 'pending' || m.status === 'thinking' || m.status === 'drafting') &&
          now - new Date(m.createdAt).getTime() < 120_000
      );
      if (!stillInFlight) setBusy(false);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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
    ><div
      suppressHydrationWarning
      className={cx('nexley-chat-root flex flex-col h-full w-full overflow-hidden bg-app', theme)}
    >
      {props.isAdminView && (
        // Make the admin banner visually loud (amber strip) so a super_admin
        // with two tabs open can't mistake tenant A for tenant B. The old
        // subtle styling faded into the page chrome.
        <div
          className="flex items-center gap-3 px-4 py-2 text-[12px] border-b-hy flex-shrink-0"
          style={{
            background: 'rgb(251 191 36 / 0.15)',
            color: 'rgb(146 64 14)',
            borderBottom: '1px solid rgb(251 191 36 / 0.5)',
          }}
          role="status"
          aria-label="Admin cross-tenant view"
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'rgb(251 191 36 / 0.4)', color: 'rgb(120 53 15)' }}
          >
            Admin view
          </span>
          <span className="truncate">
            Chatting as <strong>{props.clientName}</strong>&apos;s AI Employee. Every message you send hits the live client agent.
          </span>
          <a href="/chat" className="ml-auto underline underline-offset-2 hover:opacity-80 font-medium" style={{ color: 'rgb(120 53 15)' }}>Switch client</a>
        </div>
      )}
      {errorBanner && (
        <div
          key={errorBanner.key}
          role="alert"
          className="flex items-center gap-3 px-4 py-2 text-[12.5px] border-b-hy fg-danger flex-shrink-0 anim-fade-in"
          style={{ background: 'rgb(var(--hy-danger) / 0.1)' }}
        >
          <AlertCircle size={14} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate flex-1">{errorBanner.message}</span>
          <button
            onClick={() => setErrorBanner(null)}
            aria-label="Dismiss"
            className="ml-auto text-[11px] px-2 py-0.5 rounded hover:bg-hover fg-subtle hover:fg-base transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      {/* Sidebar wrapper — full-width on mobile (when showing the list),
          auto-width on desktop. Hidden on mobile whenever main is showing. */}
      <div className={cx(
        showMain ? 'hidden' : 'flex',
        'lg:flex flex-shrink-0 w-full lg:w-auto'
      )}>
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
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onPinSession={pinSession}
          activeView={activeView}
          onNavChange={navChange}
        />
      </div>

      {/* Main wrapper — full-width on mobile (when showing an active chat
          or sub-tab), flex-1 on desktop. Hidden on mobile when on the list. */}
      <main className={cx(
        showMain ? 'flex' : 'hidden',
        'lg:flex flex-col flex-1 min-w-0 bg-app'
      )}>
        {/* Mobile-only back chevron → pops back to the session list */}
        <div className="lg:hidden flex items-center gap-1 px-2 py-2 border-b-hy bg-app sticky top-0 z-10">
          <button
            onClick={handleMobileBack}
            aria-label="Back to chat list"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[13px] fg-base hover:bg-hover transition-colors"
          >
            <span aria-hidden="true">‹</span>
            <span className="truncate max-w-[220px]">{currentSession?.title || 'Back'}</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === 'assistant' && !currentSession && (
          <Dashboard
            suggestions={SUGGESTIONS}
            workflows={WORKFLOWS}
            onSend={sendMessage}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenMention={() => setMentionOpen(true)}
            pendingMention={pendingMention}
            onMentionConsumed={() => setPendingMention(null)}
          />
        )}
        {activeView === 'assistant' && currentSession && (
          <AssistPanel
            session={currentSession}
            onSend={sendMessage}
            onOpenSource={setOpenSource}
            streamingText=""
            busy={busy}
            rtStatus={rtStatus}
            loadingMessages={loadingSessions.has(currentSession.id) && currentSession.messages.length === 0}
            onRenameSession={renameSession}
            onDeleteSession={deleteSession}
            onPinSession={pinSession}
            onOpenMention={() => setMentionOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            pendingMention={pendingMention}
            onMentionConsumed={() => setPendingMention(null)}
            onRetryMessage={retryMessage}
            onFollowup={(t) => { void sendMessage(t); }}
          />
        )}
        {activeView === 'customers' && <CustomersView />}
        {activeView === 'vault' && <VaultView />}
        {activeView === 'workflows' && (
          <WorkflowsView
            workflows={WORKFLOWS}
            onStart={(prompt) => {
              setActiveView('assistant');
              sendMessage(prompt);
            }}
          />
        )}
        {activeView === 'history' && (
          <HistoryView
            sessions={sessions}
            onSelectSession={selectSession}
            onPinSession={pinSession}
          />
        )}
        {activeView === 'knowledge' && <KnowledgeView />}
        </div>
      </main>
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
        currentSession={currentSession}
      />
      <MentionMenu
        open={mentionOpen}
        onClose={() => setMentionOpen(false)}
        onPick={(customer) => {
          setPendingMention('@' + customer.name + ' ');
        }}
      />
    </div>
    </ClientContextProvider>
  );
}
