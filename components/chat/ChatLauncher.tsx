"use client";

/**
 * ChatLauncher — global side-panel launcher.
 *
 * Mounted once in the dashboard layout. Cmd+J (or Ctrl+J) toggles a
 * right-anchored sheet that embeds the full ChatApp in a narrow column.
 * Every dashboard tab gains instant access to the agent without having
 * to navigate to /chat — fixes the "lost context when switching pages"
 * problem from the integration research.
 *
 * Disabled (renders nothing) on /chat itself since the full-bleed page
 * is already showing the chat.
 */

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X } from 'lucide-react';
import ChatApp from './ChatApp';
import '@/styles/nexley-chat.css';

interface ChatLauncherProps {
  clientId: string;
  clientName: string;
  userEmail: string;
  ownerName?: string;
  isAdminView?: boolean;
}

export default function ChatLauncher(props: ChatLauncherProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || '';
  const disabled = pathname.startsWith('/chat');

  // Keyboard: Cmd+J / Ctrl+J toggle, Esc close
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, open]);

  if (disabled) return null;

  return (
    <>
      {/* Floating trigger button — bottom-right corner */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-foreground text-background shadow-lg hover:opacity-90 transition-all px-4 py-2 text-sm font-medium"
          aria-label="Open AI Employee chat (⌘J)"
          title="Open AI Employee chat — ⌘J"
        >
          <MessageCircle size={16} strokeWidth={2} />
          Ask your AI
          <kbd className="ml-1 text-[10px] opacity-70 font-mono">⌘J</kbd>
        </button>
      )}

      {/* Overlay sheet — right-anchored, 480px wide on desktop, full on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="AI Employee chat"
        >
          {/* Dim backdrop */}
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-in fade-in" />

          {/* Sheet */}
          <div
            className="relative h-full w-full max-w-[520px] bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} className="text-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Your AI Employee</h2>
                <span className="text-xs text-muted-foreground">{props.clientName}</span>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="hidden sm:inline text-[10px] font-mono text-muted-foreground">⌘J to toggle · Esc to close</kbd>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 hover:bg-accent transition-colors"
                  aria-label="Close"
                ><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ChatApp
                clientId={props.clientId}
                clientName={props.clientName}
                userEmail={props.userEmail}
                ownerName={props.ownerName}
                isAdminView={props.isAdminView}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
