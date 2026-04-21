"use client";

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Plus, Command as CommandIcon, Settings, ArrowUp, Loader2,
  Clock, Brain, PencilLine, AlertCircle, User, PhoneCall, FileText,
  Briefcase, Receipt, Copy, RefreshCw, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { cx, relativeTime } from '@/lib/chat/utils';
import { renderMarkdown } from '@/lib/chat/markdown';
import type { Message, Source, MessageStatus, SourceType } from '@/lib/chat/types';

interface ComposerProps {
  onSend: (text: string) => void;
  busy?: boolean;
  autoFocus?: boolean;
  variant?: 'panel' | 'hero';
  onOpenPalette?: () => void;
  onOpenMention?: () => void;
}

function Composer({ onSend, busy, autoFocus, variant = 'panel', onOpenPalette, onOpenMention }: ComposerProps) {
  const [value, setValue] = useState('');
  const [refining, setRefining] = useState(false);
  const [refinedText, setRefinedText] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 8 * 22;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [value]);

  const send = () => {
    if (!value.trim() || busy) return;
    onSend(value.trim());
    setValue('');
    setRefinedText(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits, Shift+Enter inserts newline. Ignore during IME composition.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape') {
      (e.target as HTMLTextAreaElement).blur();
      return;
    }
    if (e.key === '/' && value === '') {
      e.preventDefault();
      onOpenPalette?.();
      return;
    }
    if (e.key === '@') {
      setTimeout(() => onOpenMention?.(), 10);
    }
  };

  const doRefine = () => {
    if (!value.trim()) return;
    setRefining(true);
    setTimeout(() => {
      const tidy = value.trim().charAt(0).toUpperCase() + value.trim().slice(1);
      const withQ = tidy.endsWith('?') || tidy.endsWith('.') ? tidy : tidy + '?';
      setRefinedText(
        `Show me ${withQ.toLowerCase().replace(/^show me\s+/, '')}`.replace(/\?+$/, '?')
      );
      setRefining(false);
    }, 1200);
  };

  const acceptRefined = () => { if (refinedText) setValue(refinedText); setRefinedText(null); };
  const dismissRefined = () => { setRefinedText(null); };

  const isEmpty = !value.trim();
  const placeholder = variant === 'hero' ? 'Ask Nexley anything…' : 'Reply to Nexley…';

  return (
    <div className="w-full">
      {(refining || refinedText) && (
        <div className="mb-2 rounded-md border-hy bg-surface px-3 py-2.5 anim-fade-in">
          {refining
            ? (
              <div className="flex items-center gap-2 text-[13px] fg-subtle">
                <Sparkles size={14} className="fg-accent" />
                Refining your prompt
                <span className="flex gap-1 ml-1">
                  <span className="status-dot" style={{ animationDelay: '0ms' }} />
                  <span className="status-dot" style={{ animationDelay: '150ms' }} />
                  <span className="status-dot" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            )
            : (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles size={13} className="fg-accent" />
                  <span className="text-[11px] fg-muted uppercase tracking-wider font-medium">A clearer version</span>
                </div>
                <p className="text-[13px] fg-base mb-2 leading-snug">{refinedText}</p>
                <div className="flex gap-2">
                  <button
                    onClick={acceptRefined}
                    className="text-[12px] px-2 py-1 rounded bg-accent fg-inverse font-medium hover:opacity-90 focus-ring"
                  >Use refined</button>
                  <button
                    onClick={dismissRefined}
                    className="text-[12px] px-2 py-1 rounded fg-subtle hover:bg-hover focus-ring"
                  >Keep mine</button>
                </div>
              </div>
            )
          }
        </div>
      )}

      <div
        className={cx('rounded-md bg-surface', 'focus-within:border-hy-strong')}
        style={{
          border: variant === 'hero' ? '1px solid rgb(var(--hy-border) / 0.7)' : '1px solid rgb(var(--hy-border))',
          transition: 'border-color 0.12s ease',
          boxShadow: variant === 'hero' ? '0 1px 3px rgb(0 0 0 / 0.04), 0 4px 12px rgb(0 0 0 / 0.03)' : undefined,
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={variant === 'hero' ? 3 : 1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] fg-base outline-none"
          style={{
            minHeight: variant === 'hero' ? 84 : 36,
            fontFamily: 'var(--font-sans)',
            color: 'rgb(var(--hy-fg-base))',
          }}
        />

        <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
          <ComposerChip icon={Plus} label={variant === 'hero' ? 'Files and sources' : 'Files'} />
          <ComposerChip icon={CommandIcon} label="Prompts" onClick={onOpenPalette} />
          {variant === 'hero' && <ComposerChip icon={Settings} label="Customize" />}
          <ComposerChip icon={Sparkles} label="Improve" onClick={doRefine} disabled={isEmpty} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={send}
            disabled={isEmpty || busy}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-[12px] font-medium transition-opacity focus-ring',
              (isEmpty || busy) ? 'bg-subtle fg-muted cursor-not-allowed' : 'hover:opacity-90'
            )}
            style={(isEmpty || busy) ? undefined : { background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
          >
            {busy
              ? <Loader2 size={12} className="animate-spin" />
              : variant === 'hero' ? 'Ask Nexley' : 'Send'}
            {!busy && variant !== 'hero' && <ArrowUp size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ComposerChipProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

function ComposerChip({ icon: IconC, label, onClick, disabled }: ComposerChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] fg-subtle hover:bg-hover hover:fg-base transition-colors focus-ring whitespace-nowrap',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
      )}
    >
      <IconC size={13} />
      {label}
    </button>
  );
}

/* ───────────── Status pill ───────────── */
export function StatusPill({ status, errorMessage }: { status: MessageStatus; errorMessage?: string }) {
  const map: Record<string, { label: string; icon: React.ComponentType<{ size?: number }>; danger?: boolean }> = {
    pending: { label: 'Queued', icon: Clock },
    thinking: { label: 'Thinking', icon: Brain },
    drafting: { label: 'Drafting your reply', icon: PencilLine },
    error: { label: errorMessage || 'Something went wrong', icon: AlertCircle, danger: true },
  };
  const m = map[status] || map.thinking;
  const IconC = m.icon;
  return (
    <div
      className={cx(
        'inline-flex items-start gap-2 rounded-md px-3 py-2 text-[13px] max-w-[95%]',
        m.danger ? 'fg-danger' : 'bg-subtle fg-subtle'
      )}
      style={m.danger ? { background: 'rgb(var(--hy-danger) / 0.1)', border: '1px solid rgb(var(--hy-danger) / 0.3)' } : undefined}
    >
      <IconC size={14} />
      <span className="flex-1">{m.label}</span>
      {!m.danger && (
        <span className="flex gap-1 ml-1 mt-1.5">
          <span className="status-dot" style={{ animationDelay: '0ms' }} />
          <span className="status-dot" style={{ animationDelay: '150ms' }} />
          <span className="status-dot" style={{ animationDelay: '300ms' }} />
        </span>
      )}
    </div>
  );
}

/* ───────────── Source chips ───────────── */
export function iconForSource(type: SourceType): React.ComponentType<{ size?: number; className?: string }> {
  const map: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    contact: User,
    call: PhoneCall,
    quote: FileText,
    job: Briefcase,
    invoice: Receipt,
  };
  return map[type] || FileText;
}

export function SourceChip({ source, onOpen }: { source: Source; onOpen: (s: Source) => void }) {
  const IconC = iconForSource(source.type);
  return (
    <button
      onClick={() => onOpen(source)}
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] bg-subtle hover:bg-hover fg-subtle hover:fg-base transition-colors focus-ring"
    >
      <IconC size={12} />
      {source.label}
    </button>
  );
}

export function SourceChipLarge({ source, onOpen }: { source: Source; onOpen: (s: Source) => void }) {
  const IconC = iconForSource(source.type);
  return (
    <button
      onClick={() => onOpen(source)}
      className="inline-flex items-center gap-2.5 rounded-md border-hy bg-surface hover:bg-hover px-3 py-2 text-[13px] fg-base transition-all focus-ring text-left"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded bg-subtle fg-subtle">
        <IconC size={14} />
      </span>
      <span className="min-w-0">
        <span className="block font-medium fg-base truncate">{source.label}</span>
        {source.sublabel && <span className="block text-[11.5px] fg-muted truncate">{source.sublabel}</span>}
      </span>
    </button>
  );
}

/* ───────────── Message bubbles ───────────── */
export function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-1.5 text-[11px] fg-muted">
        <span>You</span>
        <span>·</span>
        <time style={{ fontFamily: 'var(--font-mono)' }}>{relativeTime(message.createdAt)}</time>
      </div>
      <div
        className="max-w-[85%] rounded-lg bg-subtle px-3 py-2 text-[13.5px] fg-base"
        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
      >{message.content}</div>
    </div>
  );
}

interface AssistantBubbleProps {
  message: Message;
  onOpenSource: (s: Source) => void;
  streamingText: string;
  isActive?: boolean;
}

export function AssistantBubble({ message, onOpenSource, streamingText, isActive }: AssistantBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<null | 'up' | 'down'>(null);
  const isStreaming = message.status === 'drafting';
  const content = isStreaming ? (streamingText || '') : message.content;
  return (
    <div className={cx('flex flex-col gap-1.5 group', isActive && 'relative')}>
      <div className="flex items-center gap-1.5 text-[11px] fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(var(--hy-fg-subtle))' }} />
          Assistant
        </span>
        <span>·</span>
        <time style={{ fontFamily: 'var(--font-mono)' }}>{relativeTime(message.createdAt)}</time>
      </div>
      {(message.status !== 'done' && message.status !== 'drafting')
        ? (
          <div className="flex flex-col gap-1">
            {message.status === 'error' ? (
              <StatusPill status={message.status} errorMessage={message.errorMessage} />
            ) : (
              <TypingBubble />
            )}
            <BreadcrumbStrip crumbs={message.breadcrumbs} />
          </div>
        )
        : (
          <div className="max-w-[95%] text-[13.5px] fg-base" style={{ lineHeight: 1.6 }}>
            {/* Show tool breadcrumbs while drafting so the user sees progress */}
            {message.status === 'drafting' && <BreadcrumbStrip crumbs={message.breadcrumbs} />}
            <div className="assistant-inline">
              {renderMarkdown(content, { streaming: isStreaming })}
            </div>
          </div>
        )
      }
      {message.sources && message.sources.length > 0 && message.status === 'done' && (
        <div
          className="flex flex-wrap items-center gap-1.5 mt-2 pt-2.5"
          style={{ borderTop: '1px solid rgb(var(--hy-border) / 0.6)' }}
        >
          <span className="text-[11px] fg-muted mr-1">Referenced:</span>
          {message.sources.map(s => <SourceChip key={s.id} source={s} onOpen={onOpenSource} />)}
        </div>
      )}
      {message.status === 'done' && (
        <div className="flex items-center gap-1 -ml-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <InlineAction
            icon={Copy}
            label={copied ? 'Copied!' : 'Copy'}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(content);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              } catch {
                /* ignore */
              }
            }}
          />
          <InlineAction icon={ThumbsUp} label={rating === 'up' ? 'Thanks!' : 'Good'} onClick={() => setRating('up')} active={rating === 'up'} />
          <InlineAction icon={ThumbsDown} label={rating === 'down' ? 'Noted' : 'Bad'} onClick={() => setRating('down')} active={rating === 'down'} />
        </div>
      )}
    </div>
  );
}

function TypingBubble() {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-2xl px-3.5 py-2.5 bg-subtle"
      style={{ width: 'fit-content' }}
      aria-label="Nexley is typing"
    >
      <span className="status-dot" style={{ animationDelay: '0ms' }} />
      <span className="status-dot" style={{ animationDelay: '150ms' }} />
      <span className="status-dot" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function BreadcrumbStrip({ crumbs }: { crumbs?: Array<{ kind: string; label: string }> }) {
  if (!crumbs || crumbs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 my-1">
      {crumbs.map((c, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] fg-muted"
          style={{ background: 'rgb(var(--hy-bg-subtle))', fontFamily: 'var(--font-mono)' }}
          title={c.label}
        >
          <span className="status-dot" />
          Using {c.label.length > 48 ? c.label.slice(0, 48) + '…' : c.label}
        </span>
      ))}
    </div>
  );
}

function InlineAction({
  icon: IconC,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'h-7 w-7 inline-flex items-center justify-center rounded hover:bg-hover transition-colors',
        active ? 'fg-base bg-hover' : 'fg-muted hover:fg-base'
      )}
      aria-label={label}
      title={label}
    ><IconC size={13} /></button>
  );
}

export default Composer;
