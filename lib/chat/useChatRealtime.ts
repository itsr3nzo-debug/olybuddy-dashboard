'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Message } from './types';
import { rowToMessage } from './api';

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/**
 * Subscribe to realtime INSERT + UPDATE events on agent_chat_messages for a
 * specific session. The callback receives the mapped Message.
 *
 * The bridge (VPS side) inserts an assistant placeholder, then updates its
 * status through thinking → drafting → done, and eventually writes the
 * final content. Each update fires here.
 *
 * Lifecycle hardening (added 2026-05-05 to fix the long-lived-tab wedge):
 *   1. Visibility-aware tear-down: when the tab is hidden for >2 min, drop
 *      the channel; on visibility change, wait 1s + force a fresh subscribe.
 *   2. Max-age refresh: every 10 min, force a fresh subscribe. Belt-and-
 *      braces against silent websocket death that Supabase's internal
 *      reconnect doesn't catch.
 *   3. Stale-event watchdog (handled in caller): if expected events don't
 *      arrive within N seconds of a pending row, caller bumps reconnectKey.
 *
 * `onStatus` (optional) receives lifecycle events so the UI can show a
 * "reconnecting…" pill when the websocket drops.
 */
export function useChatRealtime(
  sessionId: string | null,
  onMessage: (msg: Message, kind: 'insert' | 'update') => void,
  onStatus?: (status: RealtimeStatus) => void,
  /**
   * Bump this to force a tear-down + fresh subscribe. Used by the
   * "Reconnect" button on the dropped-connection banner so the user can
   * manually retry instead of waiting for Supabase's internal backoff.
   */
  reconnectKey?: number,
): void {
  // Internal nonce that we bump from visibility changes + max-age refresh.
  // Effect re-runs whenever this OR the external reconnectKey changes.
  const [internalNonce, setInternalNonce] = useState(0);

  // Visibility-aware lifecycle: when tab is hidden >2 min, tear down. On
  // visibility change → wait 1s, then bump nonce to force fresh subscribe.
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const HIDDEN_TEARDOWN_MS = 2 * 60 * 1000;
    const onVis = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current && Date.now() - hiddenSinceRef.current > HIDDEN_TEARDOWN_MS) {
        hiddenSinceRef.current = null;
        // Wait a beat for any tab-wake reconnect dust to settle, then
        // force a clean re-subscribe.
        setTimeout(() => setInternalNonce((n) => n + 1), 1000);
      } else {
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Max-age refresh: every 10 min on a session, drop + resubscribe. Catches
  // the silent-websocket-death case Supabase's client doesn't always notice.
  useEffect(() => {
    if (!sessionId) return;
    const MAX_AGE_MS = 10 * 60 * 1000;
    const t = setInterval(() => setInternalNonce((n) => n + 1), MAX_AGE_MS);
    return () => clearInterval(t);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      onStatus?.('idle');
      return;
    }
    const supabase = createClient();
    onStatus?.('connecting');

    const channel = supabase
      .channel(`chat:${sessionId}:${internalNonce}:${reconnectKey ?? 0}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Parameters<typeof rowToMessage>[0];
          onMessage(rowToMessage(row), 'insert');
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Parameters<typeof rowToMessage>[0];
          onMessage(rowToMessage(row), 'update');
        }
      )
      .subscribe((status) => {
        // Supabase passes SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED.
        // Translate into our vocabulary.
        if (status === 'SUBSCRIBED') onStatus?.('open');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error');
        else if (status === 'CLOSED') onStatus?.('closed');
      });

    return () => {
      void supabase.removeChannel(channel).catch(() => {});
      onStatus?.('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, internalNonce, reconnectKey]);
}
