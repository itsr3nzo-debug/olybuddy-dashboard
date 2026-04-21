"use client";

import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Plus, Command as CommandIcon, Settings, ArrowUp, Loader2,
  Clock, Brain, PencilLine, AlertCircle, User, PhoneCall, FileText,
  Briefcase, Receipt, Copy, RefreshCw, ThumbsUp, ThumbsDown, X,
  ImageIcon, Film, FileAudio, File as FileIconLucide,
} from 'lucide-react';
import { cx, relativeTime } from '@/lib/chat/utils';
import { renderMarkdown } from '@/lib/chat/markdown';
import { uploadAttachment } from '@/lib/chat/upload';
import { useClient } from '@/lib/chat/client-context';
import type { Message, Source, MessageStatus, SourceType, Attachment } from '@/lib/chat/types';

interface ComposerProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  busy?: boolean;
  autoFocus?: boolean;
  variant?: 'panel' | 'hero';
  onOpenPalette?: () => void;
  onOpenMention?: () => void;
  /** Current session id (null for draft / hero before first send). */
  sessionId?: string | null;
  /** Text to inject at cursor (e.g. @mention picked from the mention menu). */
  pendingMention?: string | null;
  /** Called after pendingMention has been consumed so the parent can clear it. */
  onMentionConsumed?: () => void;
}

function Composer({ onSend, busy, autoFocus, variant = 'panel', onOpenPalette, onOpenMention, sessionId, pendingMention, onMentionConsumed }: ComposerProps) {
  const { clientId } = useClient();
  const [value, setValue] = useState('');
  const [refining, setRefining] = useState(false);
  const [refinedText, setRefinedText] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!pendingMention) return;
    const ta = textareaRef.current;
    const pos = ta ? (ta.selectionStart ?? value.length) : value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    setValue(before + pendingMention + after);
    onMentionConsumed?.();
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const newPos = pos + pendingMention.length;
      ta.setSelectionRange(newPos, newPos);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMention]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 8 * 22;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [value]);

  const send = () => {
    const hasText = value.trim().length > 0;
    const hasFiles = attachments.length > 0;
    if ((!hasText && !hasFiles) || busy || uploading) return;
    onSend(value.trim(), attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    setUploadError(null);
    setRefinedText(null);
  };

  const pickFiles = () => {
    fileInputRef.current?.click();
  };

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const uploaded: Attachment[] = [];
    for (const f of files) {
      const res = await uploadAttachment(f, clientId, sessionId ?? null);
      if (res.ok) uploaded.push(res.attachment);
      else setUploadError(res.error);
    }
    setAttachments((prev) => [...prev, ...uploaded]);
    setUploading(false);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
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

  const isEmpty = !value.trim() && attachments.length === 0;
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
        {(attachments.length > 0 || uploading || uploadError) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a, i) => (
              <AttachmentChip key={i} attachment={a} onRemove={() => removeAttachment(i)} />
            ))}
            {uploading && (
              <div className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] bg-subtle fg-subtle">
                <Loader2 size={12} className="animate-spin" />
                Uploading…
              </div>
            )}
            {uploadError && (
              <div className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] fg-danger" style={{ background: 'rgb(var(--hy-danger) / 0.1)' }}>
                <AlertCircle size={12} />
                {uploadError}
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,application/pdf,text/*,.csv,.json,.docx,.xlsx"
          className="hidden"
          onChange={onFilesPicked}
        />
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
          <ComposerChip icon={Plus} label={variant === 'hero' ? 'Files and sources' : 'Files'} onClick={pickFiles} />
          <ComposerChip icon={CommandIcon} label="Prompts" onClick={onOpenPalette} />
          {variant === 'hero' && <ComposerChip icon={Settings} label="Customize" onClick={onOpenPalette} />}
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

/* ───────────── Attachment chip (composer draft) ───────────── */
function iconForAttachment(a: Attachment) {
  if (a.kind === 'image') return ImageIcon;
  if (a.kind === 'video') return Film;
  if (a.kind === 'audio') return FileAudio;
  if (a.kind === 'pdf') return FileText;
  return FileIconLucide;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const Icon = iconForAttachment(attachment);
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] fg-subtle"
      style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
    >
      {attachment.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={attachment.url} alt={attachment.name} className="h-5 w-5 rounded object-cover" />
      ) : (
        <Icon size={12} />
      )}
      <span className="max-w-[160px] truncate">{attachment.name}</span>
      <span className="fg-muted text-[10.5px]">{fmtBytes(attachment.size)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 -mr-0.5 h-4 w-4 inline-flex items-center justify-center rounded hover:bg-hover fg-muted hover:fg-base"
        aria-label="Remove"
      >
        <X size={10} />
      </button>
    </div>
  );
}

/* ───────────── Message bubbles ───────────── */
export function UserBubble({ message }: { message: Message }) {
  const atts = message.attachments ?? [];
  return (
    <div className="flex flex-col items-end gap-1.5" title={relativeTime(message.createdAt)}>
      {atts.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2 max-w-[80%]">
          {atts.map((a, i) => <AttachmentPreview key={i} attachment={a} />)}
        </div>
      )}
      {message.content && (
        <div
          className="max-w-[80%] rounded-2xl px-4 py-2.5 text-[14px] fg-base"
          style={{
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5,
            background: 'rgb(var(--hy-bg-subtle))',
            border: '1px solid rgb(var(--hy-border) / 0.5)',
          }}
        >{message.content}</div>
      )}
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const Icon = iconForAttachment(attachment);
  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.name}
          className="rounded-xl max-h-60 object-cover"
          style={{ border: '1px solid rgb(var(--hy-border) / 0.5)' }}
        />
      </a>
    );
  }
  if (attachment.kind === 'video') {
    return (
      <video
        src={attachment.url}
        controls
        className="rounded-xl max-h-60"
        style={{ border: '1px solid rgb(var(--hy-border) / 0.5)' }}
      />
    );
  }
  if (attachment.kind === 'audio') {
    return <audio src={attachment.url} controls className="rounded-xl" />;
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] fg-base hover:bg-hover transition-colors"
      style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border) / 0.5)' }}
    >
      <Icon size={16} />
      <span className="max-w-[220px] truncate">{attachment.name}</span>
      <span className="fg-muted text-[10.5px]">{fmtBytes(attachment.size)}</span>
    </a>
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
  // Hide the bubble entirely while in-flight — show only the final reply.
  // Errors still render so the user gets feedback if something goes wrong.
  if (message.status === 'pending' || message.status === 'thinking') return null;
  return (
    <div className={cx('flex gap-3 group', isActive && 'relative')}>
      <div
        className="flex-shrink-0 h-7 w-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
        style={{
          background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
          color: '#fff',
        }}
        aria-hidden="true"
        title="Nexley AI"
      >N</div>
      <div className="flex-1 min-w-0 pt-0.5">
      {(message.status !== 'done' && message.status !== 'drafting')
        ? (
          message.status === 'error'
            ? <StatusPill status={message.status} errorMessage={message.errorMessage} />
            : null
        )
        : (
          <div className="text-[14px] fg-base" style={{ lineHeight: 1.65 }}>
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
