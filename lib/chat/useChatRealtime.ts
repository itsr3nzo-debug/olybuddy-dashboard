'use client';

import { useEffect } from 'react';
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
 * `onStatus` (optional) receives lifecycle events so the UI can show a
 * "reconnecting…" pill when the websocket drops. We intentionally do NOT
 * auto-reconnect — Supabase's client handles that; we just observe.
 */
export function useChatRealtime(
  sessionId: string | null,
  onMessage: (msg: Message, kind: 'insert' | 'update') => void,
  onStatus?: (status: RealtimeStatus) => void,
): void {
  useEffect(() => {
    if (!sessionId) {
      onStatus?.('idle');
      return;
    }
    const supabase = createClient();
    onStatus?.('connecting');

    const channel = supabase
      .channel(`chat:${sessionId}`)
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
      supabase.removeChannel(channel);
      onStatus?.('closed');
    };
  }, [sessionId, onMessage, onStatus]);
}
