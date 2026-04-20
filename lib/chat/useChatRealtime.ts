'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Message } from './types';
import { rowToMessage } from './api';

/**
 * Subscribe to realtime INSERT + UPDATE events on agent_chat_messages for a
 * specific session. The callback receives the mapped Message.
 *
 * The bridge (VPS side) inserts an assistant placeholder, then updates its
 * status through thinking → drafting → done, and eventually writes the
 * final content. Each update fires here.
 */
export function useChatRealtime(
  sessionId: string | null,
  onMessage: (msg: Message, kind: 'insert' | 'update') => void
): void {
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, onMessage]);
}
