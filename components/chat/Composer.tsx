"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSmoothedContent } from '@/lib/chat/useSmoothedContent';
import {
  Wand2, Plus, Command as CommandIcon, Settings, ArrowUp, Loader2,
  Clock, Brain, PencilLine, AlertCircle, User, PhoneCall, FileText,
  Briefcase, Receipt, Copy, RefreshCw, ThumbsUp, ThumbsDown, X,
  ImageIcon, Film, FileAudio, File as FileIconLucide, Mic, MicOff,
} from 'lucide-react';
import { cx, relativeTime, absoluteTime } from '@/lib/chat/utils';
import { renderMarkdown } from '@/lib/chat/markdown';
import { uploadAttachment } from '@/lib/chat/upload';
import { useClient } from '@/lib/chat/client-context';
import type { Message, Source, MessageStatus, SourceType, Attachment } from '@/lib/chat/types';

interface ComposerProps {
  /**
   * Send handler. May return a promise resolving to a boolean — `false`
   * signals the send failed (e.g. API error) and the Composer will restore
   * the user's text + attachments so they can retry. Legacy void callers
   * keep their old behaviour (clear on submit, no restore).
   */
  onSend: (text: string, attachments?: Attachment[]) => Promise<boolean> | void;
  /** Called when the user clicks Stop during an in-flight reply. Parent
   * should mark the active assistant row as cancelled (local state + DB),
   * so the UI releases `busy` and the composer is usable again. The
   * bridge will still complete the upstream generation — last-write-wins. */
  onCancel?: () => void;
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
  /** One-shot text that REPLACES the composer value (used for Edit &
   * resend, to preload the user's original message). */
  pendingDraft?: string | null;
  onDraftConsumed?: () => void;
}

function Composer({ onSend, onCancel, busy, autoFocus, variant = 'panel', onOpenPalette, onOpenMention, sessionId, pendingMention, onMentionConsumed, pendingDraft, onDraftConsumed }: ComposerProps) {
  const { clientId } = useClient();
  // Draft auto-save — on every keystroke, persist the composer contents
  // keyed by session (or 'new' for a fresh chat). Survives page refresh
  // and accidental tab close. Clears on successful send.
  const draftKey = `nexley-draft:${sessionId ?? 'new'}`;
  const [value, setValue] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try { return window.localStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (value) window.localStorage.setItem(draftKey, value);
      else window.localStorage.removeItem(draftKey);
    } catch { /* quota / blocked — ignore */ }
  }, [value, draftKey]);
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

  // One-shot prefill for Edit & resend — REPLACES composer value entirely
  // (unlike pendingMention which inserts at cursor). Parent is responsible
  // for calling onDraftConsumed so we don't re-apply on every render.
  useEffect(() => {
    if (typeof pendingDraft !== 'string') return;
    setValue(pendingDraft);
    onDraftConsumed?.();
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(pendingDraft.length, pendingDraft.length);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDraft]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 8 * 22;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [value]);

  const send = async () => {
    const hasText = value.trim().length > 0;
    const hasFiles = attachments.length > 0;
    if ((!hasText && !hasFiles) || busy || uploading) return;
    // Snapshot text + attachments BEFORE clearing so we can restore them if
    // the parent reports a send failure (returns false). Old void-returning
    // callers get the previous clear-on-send behaviour.
    const prevText = value.trim();
    const prevAtt = attachments;
    setValue('');
    setAttachments([]);
    setUploadError(null);
    setRefinedText(null);
    const result = onSend(prevText, prevAtt.length > 0 ? prevAtt : undefined);
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      const ok = await (result as Promise<boolean>);
      if (ok === false) {
        // Send failed — put the text + attachments back so the user can retry
        // without re-typing.
        setValue(prevText);
        setAttachments(prevAtt);
      }
    }
  };

  const pickFiles = () => {
    fileInputRef.current?.click();
  };

  // Voice input via MediaRecorder → POST /api/transcribe (ElevenLabs Scribe).
  // We deliberately do NOT use the browser's SpeechRecognition API — it
  // only works in Chrome/Edge, fails silently on Safari, doesn't exist
  // on Firefox, and requires Google's cloud anyway in older versions.
  // MediaRecorder + server-side STT works in every modern browser, gives
  // us better accuracy (Scribe v1), and surfaces real errors to the user.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  // Mount tracking — MediaRecorder.onstop and the /api/transcribe fetch
  // promise can both fire AFTER the Composer has unmounted (user navigates
  // away mid-recording, mid-transcription, or strict-mode double-mount).
  // Guard every setState in those callbacks against this ref so we don't
  // log "setState on unmounted component" warnings or, worse, lose a
  // pending transcribing=true forever on a remount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // MediaRecorder is supported in every modern browser (incl. Safari 14+)
  // and on every device that has a microphone. We render the button
  // unconditionally so users on niche browsers still see it; if it fails
  // we surface a clear error in-line.
  const voiceSupported = true;

  // Pick a MIME type the current browser actually supports. Chrome/Firefox
  // → opus/webm; Safari → mp4. ElevenLabs Scribe accepts all three.
  function pickRecorderMime(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg;codecs=opus',
    ];
    for (const m of candidates) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
    }
    return '';
  }

  async function startRecording() {
    setVoiceError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone not available in this browser.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (/denied|NotAllowed/i.test(msg) || (e as { name?: string })?.name === 'NotAllowedError') {
        setVoiceError('Microphone permission denied. Allow it in your browser address bar, then try again.');
      } else if ((e as { name?: string })?.name === 'NotFoundError') {
        setVoiceError('No microphone found.');
      } else {
        setVoiceError('Could not access the microphone.');
      }
      return;
    }
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setVoiceError('This browser cannot record audio.');
      return;
    }
    audioChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
    recorder.onstop = () => {
      // Tear down mic right away so the browser indicator clears, even
      // if we're already unmounting — this is a synchronous cleanup that
      // doesn't touch React state.
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      const blob = new Blob(audioChunksRef.current, { type: mime || 'audio/webm' });
      audioChunksRef.current = [];
      // Skip the upload entirely if the component has unmounted between
      // recorder.stop() and the onstop fire. The blob is dropped — better
      // than a zombie transcription that can't update state.
      if (!mountedRef.current) return;
      void uploadForTranscription(blob);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach(t => t.stop());
      if (!mountedRef.current) return;
      setRecording(false);
      setVoiceError('Recording failed. Try again.');
    };
    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    recordingStartRef.current = Date.now();
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    const r = mediaRecorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') r.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  async function uploadForTranscription(blob: Blob) {
    if (Date.now() - recordingStartRef.current < 400) {
      // User tapped the button — didn't actually record anything.
      if (mountedRef.current) setVoiceError('Hold the mic button longer to record.');
      return;
    }
    if (mountedRef.current) setTranscribing(true);
    try {
      const fd = new FormData();
      const ext = (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('mpeg') ? 'mp3' : 'webm');
      fd.append('audio', new File([blob], `voice.${ext}`, { type: blob.type }));
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      // Bail before any setState if the component has been torn down
      // between fetch start and finish — typical when the user navigates
      // away mid-transcription on a slow connection.
      if (!mountedRef.current) return;
      const json = await res.json().catch(() => ({ ok: false, error: 'invalid_response' }));
      if (!mountedRef.current) return;
      if (!res.ok || !json.ok) {
        const errMap: Record<string, string> = {
          unauthorized: 'Sign in to use voice input.',
          transcription_not_configured: 'Voice input not configured.',
          recording_too_short: 'Recording was too short.',
          no_speech_detected: 'No speech detected.',
          audio_too_large: 'Recording was too long.',
        };
        setVoiceError(errMap[json.error] || 'Transcription failed. Try again.');
        return;
      }
      const text = String(json.text || '').trim();
      if (!text) { setVoiceError('No speech detected.'); return; }
      const base = valueRef.current;
      const prefix = base.length > 0 && !/\s$/.test(base) ? base + ' ' : base;
      setValue(prefix + text);
    } catch {
      if (mountedRef.current) setVoiceError('Network error. Try again.');
    } finally {
      if (mountedRef.current) setTranscribing(false);
    }
  }

  const toggleRecording = () => {
    setVoiceError(null);
    if (transcribing) return;
    if (recording) stopRecording(); else void startRecording();
  };

  // Stop recording if the Composer unmounts mid-session
  useEffect(() => () => {
    try { mediaRecorderRef.current?.stop(); } catch {}
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // Auto-clear voice error after 6s so it doesn't linger.
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 6000);
    return () => clearTimeout(t);
  }, [voiceError]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded: Attachment[] = [];
      for (const f of files) {
        const res = await uploadAttachment(f, clientId, sessionId ?? null);
        if (res.ok) uploaded.push(res.attachment);
        else setUploadError(res.error);
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      // Always release uploading — a thrown error from the library would
      // otherwise leave the composer pinned in the uploading state forever.
      setUploading(false);
    }
  };

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await uploadFiles(files);
  };

  // Handle paste of images (screenshot → ⌘V). Plain text paste behaves
  // normally — only intercept when the clipboard holds a file.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items.filter(it => it.kind === 'file').map(it => it.getAsFile()).filter((f): f is File => !!f);
    if (files.length > 0) {
      e.preventDefault();
      void uploadFiles(files);
    }
  };

  // Whole-window drag-drop — listen at document level so users can drop
  // anywhere on the chat, not just on the composer. Shows a full-page
  // "Drop to upload" overlay while a file is being dragged in.
  //
  // Only the `panel` composer (the one attached to an active chat) owns
  // the window listener. The `hero` composer on the empty-state
  // Dashboard shouldn't register a duplicate — otherwise BOTH composers
  // upload the same file when the user drops and only one Composer is
  // visible at a time anyway.
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  useEffect(() => {
    // Hero variant lives inside the empty-state Dashboard. When the user
    // has no active session both variants may mount briefly; skip hero
    // so the panel variant (which fills the main chat surface) wins.
    if (variant === 'hero') return;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragLeave = () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault(); // required to allow drop
      }
    };
    const onDrop = (e: DragEvent) => {
      dragDepthRef.current = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      e.preventDefault();
      void uploadFiles(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, sessionId, variant]);

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
      {/* Whole-window drop overlay — shown while a file is being dragged
          anywhere on the page. The actual drop handler is window-level, so
          this overlay is just a visual cue; dropping on it vs anywhere
          else behaves identically. */}
      {dragActive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ background: 'rgb(var(--hy-fg-base) / 0.05)' }}
        >
          <div
            className="rounded-xl px-6 py-5 text-center anim-fade-in"
            style={{
              background: 'rgb(var(--hy-bg-surface))',
              border: '2px dashed rgb(var(--hy-fg-base))',
              boxShadow: '0 20px 40px rgb(0 0 0 / 0.15)',
            }}
          >
            <div className="text-[14px] fg-base font-medium mb-1">Drop to attach</div>
            <div className="text-[11.5px] fg-muted">Files will be uploaded to this chat</div>
          </div>
        </div>
      )}
      {(refining || refinedText) && (
        <div className="mb-2 rounded-md border-hy bg-surface px-3 py-2.5 anim-fade-in">
          {refining
            ? (
              <div className="flex items-center gap-2 text-[13px] fg-subtle">
                <Wand2 size={14} strokeWidth={1.5} className="fg-accent" />
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
                  <Wand2 size={13} strokeWidth={1.5} className="fg-accent" />
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
        className={cx(
          'rounded-md bg-surface composer-focus',
          variant === 'panel' && 'composer-panel',
        )}
        style={{
          border: variant === 'hero' ? '1px solid rgb(var(--hy-border) / 0.7)' : '1px solid rgb(var(--hy-border))',
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
          onPaste={onPaste}
          placeholder={placeholder}
          rows={variant === 'hero' ? 3 : 1}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] fg-base outline-none"
          style={{
            minHeight: variant === 'hero' ? 84 : 36,
            fontFamily: 'var(--font-sans)',
            color: 'rgb(var(--hy-fg-base))',
          }}
        />

        {voiceError && (
          <div
            role="alert"
            className="mx-3 mb-1 mt-1 px-2.5 py-1.5 rounded-md flex items-center gap-2 text-[11.5px]"
            style={{
              background: 'rgb(var(--hy-danger) / 0.10)',
              color: 'rgb(var(--hy-danger))',
              border: '1px solid rgb(var(--hy-danger) / 0.25)',
            }}
          >
            <AlertCircle size={12} className="flex-shrink-0" />
            <span className="flex-1">{voiceError}</span>
            <button
              type="button"
              onClick={() => setVoiceError(null)}
              aria-label="Dismiss"
              className="opacity-70 hover:opacity-100 flex-shrink-0"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <div className={cx(
          'flex items-center gap-1 pb-2 pt-1',
          variant === 'hero' ? 'px-3' : 'px-2'
        )}>
          <ComposerChip icon={Plus} label={variant === 'hero' ? 'Files and sources' : 'Files'} onClick={pickFiles} />
          {voiceSupported && (
            <ComposerChip
              icon={transcribing ? Loader2 : (recording ? MicOff : Mic)}
              label={transcribing ? 'Transcribing…' : (recording ? 'Stop' : 'Voice')}
              onClick={toggleRecording}
              active={recording}
              spinning={transcribing}
              disabled={transcribing}
            />
          )}
          <ComposerChip icon={CommandIcon} label="Prompts" onClick={onOpenPalette} />
          {/* "Customize" button removed — it was wired to the same onOpenPalette
              handler as "Prompts" above, so two visible buttons triggered the
              exact same overlay. Kept the single Prompts entry. */}
          <ComposerChip icon={Wand2} label="Improve" onClick={doRefine} disabled={isEmpty} />
          <div className="flex-1 min-w-2" />
          {/* Subtle keyboard-shortcut hint — only on the hero composer where
              there's room. Disappears once the user starts typing so it
              doesn't compete with the Send CTA's affordance. Fills what
              was previously a dead empty void in the toolbar middle. */}
          {variant === 'hero' && isEmpty && (
            <span
              aria-hidden="true"
              className="hidden md:inline-flex items-center gap-1 text-[11px] fg-muted mr-1 select-none"
            >
              <kbd
                className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{
                  background: 'rgb(var(--hy-bg-subtle))',
                  border: '1px solid rgb(var(--hy-border))',
                  color: 'rgb(var(--hy-fg-muted))',
                }}
              >⏎</kbd>
              <span>to send</span>
            </span>
          )}
          {busy && onCancel ? (
            // During an in-flight reply, replace Send with Stop — clicking
            // marks the reply as cancelled locally (bridge still completes
            // upstream, but the user is unblocked immediately).
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop generating"
              className={cx(
                'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-opacity focus-ring hover:opacity-90 leading-none',
                variant === 'hero' ? 'px-3.5 h-8 text-[12.5px]' : 'px-2.5 h-7 text-[12px]'
              )}
              style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5"
                style={{ background: 'currentColor', borderRadius: 1 }}
              />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={isEmpty || busy}
              className={cx(
                'inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus-ring transition-all leading-none',
                variant === 'hero' ? 'px-3.5 h-8 text-[12.5px]' : 'px-2.5 h-7 text-[12px]',
                (isEmpty || busy)
                  ? 'bg-subtle fg-muted cursor-not-allowed'
                  : 'cta-ready',
              )}
              style={(isEmpty || busy) ? undefined : { background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
            >
              {busy
                ? <Loader2 size={12} className="animate-spin" />
                : variant === 'hero' ? 'Ask Nexley' : 'Send'}
              {!busy && variant !== 'hero' && <ArrowUp size={12} />}
              {!busy && variant === 'hero' && <ArrowUp size={13} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ComposerChipProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Active = highlighted pill (currently recording, etc.) */
  active?: boolean;
  /** Spin the icon (used while transcribing). */
  spinning?: boolean;
}

function ComposerChip({ icon: IconC, label, onClick, disabled, active, spinning }: ComposerChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] transition-colors focus-ring whitespace-nowrap',
        active
          ? 'fg-base'
          : 'fg-subtle hover:bg-hover hover:fg-base',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
      )}
      style={active ? { background: 'rgb(var(--hy-danger) / 0.12)', color: 'rgb(var(--hy-danger))' } : undefined}
    >
      <IconC size={13} className={spinning ? 'animate-spin' : undefined} />
      {label}
      {active && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse ml-0.5"
        />
      )}
    </button>
  );
}

/* ───────────── Status pill ───────────── */
export function StatusPill({
  status,
  errorMessage,
  onRetry,
}: {
  status: MessageStatus;
  errorMessage?: string;
  /** Optional retry handler — only rendered when status is error. */
  onRetry?: () => void;
}) {
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
      {m.danger && onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[12px] fg-base font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          <RefreshCw size={11} />
          Try again
        </button>
      )}
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

/**
 * Chip for a vault file the agent cited with `[vault:<uuid>]`. On mount we
 * resolve the file to its filename + signed URL via /api/vault/files/[id]/url;
 * click opens the signed URL in a new tab. RLS on the url endpoint means a
 * citation for a file the user can't see will show "Unknown file" — the
 * chip never leaks existence of cross-tenant files.
 */
function VaultCitationChip({ fileId }: { fileId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [filename, setFilename] = useState<string>('');
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/vault/files/${fileId}/url`)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (!alive) return;
        if (!body || !body.filename) { setState('missing'); return; }
        setFilename(body.filename);
        setUrl(body.url);
        setState('ready');
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, [fileId]);

  const label = state === 'loading' ? 'Loading…' : state === 'missing' ? 'File unavailable' : filename;
  const disabled = state !== 'ready';

  return (
    <a
      href={disabled ? undefined : url}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] bg-subtle transition-colors focus-ring max-w-[320px]',
        disabled ? 'fg-muted cursor-default' : 'hover:bg-hover fg-subtle hover:fg-base',
      )}
      title={state === 'ready' ? `Open ${filename}` : undefined}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
    >
      <FileText size={12} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </a>
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
export function UserBubble({ message, onEdit }: { message: Message; onEdit?: (messageId: string, content: string) => void }) {
  const atts = message.attachments ?? [];
  return (
    <div
      className="flex flex-col items-end gap-1.5 anim-bubble-in group"
      data-message-id={message.id}
      title={absoluteTime(message.createdAt)}
    >
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
      {/* Edit & resend — clicking loads the message into the composer and
          truncates the thread at this point, so the user can tweak and
          regenerate. ChatGPT-free-tier style (no branch history kept). */}
      {onEdit && message.content && (
        <button
          onClick={() => onEdit(message.id, message.content)}
          className="text-[11px] fg-muted hover:fg-base transition-colors opacity-0 group-hover:opacity-100 focus-within:opacity-100 focus:opacity-100"
        >
          Edit
        </button>
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
  /** Fired when the user clicks "Try again" on an errored reply. Parent is
   * responsible for resending the corresponding user message. */
  onRetry?: (messageId: string) => void;
  /** Fired when the user clicks a suggested follow-up chip — parent sends
   * it as a new user message. */
  onFollowup?: (text: string) => void;
  /** Fired when the user clicks an artifact chip — parent opens the
   * artifact side pane with the full content. */
  onOpenArtifact?: (artifact: ChatArtifact) => void;
}

// Vault citation tokens the agent emits inline when it references a file
// from the user's Vault. We strip them from the rendered text and show
// clickable chips beneath the reply. UUID shape is the one Supabase
// generates (8-4-4-4-12 hex).
const VAULT_CITATION_RE = /\[vault:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/g;
// Follow-up suggestion tokens the agent emits at the end of a reply to
// propose next actions. Shape: `[followup: Send a follow-up SMS]`. Up to
// 3 are rendered as clickable chips that pre-fill the composer.
const FOLLOWUP_RE = /\[followup:\s*([^\]]{2,120})\]/g;
// Plan tokens — for multi-step tasks, the agent proposes a plan the owner
// can Approve / Edit / Cancel. Shape:
//   `[plan: step one | step two | step three]`
// Pipes delimit steps. First occurrence wins; up to 8 steps.
const PLAN_RE = /\[plan:\s*([^\]]+?)\]/g;
// Artifact tokens — for long outputs (quotes, emails, contracts, code) the
// agent wraps content in an artifact block that opens in a side pane
// instead of bloating the chat. Shape:
//   [artifact type="quote" title="Jones rewire quote"]
//   ...body...
//   [/artifact]
// Matches multiline non-greedy. Up to 4 artifacts per reply.
const ARTIFACT_RE = /\[artifact(?:\s+type="([^"]*)")?(?:\s+title="([^"]*)")?\]([\s\S]*?)\[\/artifact\]/g;
export interface ChatArtifact {
  type: string;
  title: string;
  body: string;
}
function parseVaultCitations(raw: string): {
  stripped: string;
  fileIds: string[];
  followups: string[];
  plan: string[];
  artifacts: ChatArtifact[];
} {
  if (!raw) return { stripped: raw, fileIds: [], followups: [], plan: [], artifacts: [] };
  const ids = new Set<string>();
  const followups: string[] = [];
  let plan: string[] = [];
  const artifacts: ChatArtifact[] = [];
  let stripped = raw.replace(VAULT_CITATION_RE, (_match, id: string) => {
    ids.add(id);
    return '';
  });
  stripped = stripped.replace(FOLLOWUP_RE, (_match, text: string) => {
    const clean = text.trim();
    if (clean && followups.length < 3 && !followups.includes(clean)) followups.push(clean);
    return '';
  });
  stripped = stripped.replace(PLAN_RE, (_match, body: string) => {
    if (plan.length > 0) return ''; // first plan wins
    plan = body.split('|').map(s => s.trim()).filter(s => s.length >= 2).slice(0, 8);
    return '';
  });
  stripped = stripped.replace(ARTIFACT_RE, (match, type: string | undefined, title: string | undefined, body: string) => {
    if (artifacts.length >= 4) return match;
    artifacts.push({
      type: (type || 'document').trim(),
      title: (title || `Artifact ${artifacts.length + 1}`).trim(),
      body: (body || '').trim(),
    });
    // Remove the artifact block from the prose entirely. Chips render
    // below the reply with a count + Open action.
    return '';
  });
  stripped = stripped.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return { stripped: stripped.trim(), fileIds: [...ids], followups, plan, artifacts };
}

function AssistantBubbleInner({ message, onOpenSource, streamingText, isActive, onRetry, onFollowup, onOpenArtifact }: AssistantBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<null | 'up' | 'down'>(null);
  const [planDecision, setPlanDecision] = useState<'pending' | 'approved' | 'cancelled'>('pending');
  const isStreaming = message.status === 'drafting';
  // Smooth the bridge's bursty incremental writes into a steady 60 char/s
  // reveal while drafting. Once done, snap to final content.
  const targetContent = isStreaming
    ? (streamingText || message.content || '')
    : message.content;
  const smoothedContent = useSmoothedContent(targetContent, isStreaming);
  const rawContent = isStreaming ? smoothedContent : message.content;
  // Memoise the regex parse — avoids re-running four token regexes on every
  // animation frame during streaming. Content length changes drive the memo.
  const { stripped: content, fileIds: vaultFileIds, followups, plan, artifacts } = useMemo(
    () => parseVaultCitations(rawContent),
    [rawContent],
  );
  // Show status pill for in-flight states so the user isn't left staring at a blank screen.
  return (
    <div
      className={cx('flex gap-3 group anim-bubble-in', isActive && 'relative')}
      data-message-id={message.id}
      title={absoluteTime(message.createdAt)}
    >
      <div
        className="flex-shrink-0 h-7 w-7 rounded-full inline-flex items-center justify-center text-[11px] font-semibold"
        style={{
          // Solid inverse-tone tile — matches the chat's own "no accent hue"
          // design rule in styles/nexley-chat.css. Was a violet→indigo
          // gradient that leaked the AI-startup aesthetic into a surface
          // that had otherwise been deliberately monochromed.
          background: 'rgb(var(--hy-fg-base))',
          color: 'rgb(var(--hy-fg-inverse))',
        }}
        aria-hidden="true"
        title="Nexley AI"
      >N</div>
      <div className="flex-1 min-w-0 pt-0.5">
      {/* Live tool trace — shown above the content (or pill) while reply is
          in-flight, and below the content (collapsed) once done. The bridge
          writes breadcrumbs into metadata.breadcrumbs as the agent streams,
          so we render whatever's there at current render time. */}
      {(message.status === 'pending' || message.status === 'thinking' || message.status === 'drafting') && (
        <BreadcrumbStrip crumbs={message.breadcrumbs} active />
      )}
      {/* Plan card — agent emits `[plan: a | b | c]` for multi-step tasks.
          Renders as a numbered checklist with Approve / Cancel buttons.
          Approve fires onFollowup("APPROVED — proceed with the plan") which
          the agent treats as go-ahead. */}
      {message.status === 'done' && plan.length > 0 && (
        <div
          className="rounded-lg p-4 my-2"
          style={{
            background: 'rgb(var(--hy-bg-subtle))',
            border: '1px solid rgb(var(--hy-border))',
          }}
        >
          <div className="text-[11px] fg-muted uppercase tracking-wider mb-2">Proposed plan</div>
          <ol className="space-y-1.5 mb-3">
            {plan.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] fg-base leading-snug">
                <span
                  className="flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10.5px] font-semibold mt-px"
                  style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
                >
                  {i + 1}
                </span>
                <span className="flex-1">{step}</span>
              </li>
            ))}
          </ol>
          {planDecision === 'pending' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPlanDecision('approved');
                  onFollowup?.('APPROVED — proceed with the plan');
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-3 h-7 text-[12px] font-medium focus-ring"
                style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
              >
                Approve &amp; run
              </button>
              <button
                onClick={() => setPlanDecision('cancelled')}
                className="inline-flex items-center gap-1.5 rounded-md px-3 h-7 text-[12px] fg-subtle hover:fg-base hover:bg-hover transition-colors"
              >
                Cancel
              </button>
              <span className="text-[11px] fg-muted ml-auto">Tap Approve to let the AI Employee run these steps</span>
            </div>
          ) : (
            <div className="text-[11.5px] fg-muted">
              {planDecision === 'approved' ? '✓ Approved — running…' : '✗ Cancelled'}
            </div>
          )}
        </div>
      )}
      {(message.status !== 'done' && message.status !== 'drafting')
        ? (
          (message.status === 'error' || message.status === 'pending' || message.status === 'thinking')
            ? <StatusPill
                status={message.status}
                errorMessage={message.errorMessage}
                onRetry={message.status === 'error' && onRetry ? () => onRetry(message.id) : undefined}
              />
            : null
        )
        : (
          <div
            className="text-[14px] fg-base"
            style={{ lineHeight: 1.65 }}
            role={isStreaming ? 'status' : undefined}
            aria-live={isStreaming ? 'polite' : undefined}
            aria-atomic="false"
          >
            <div className="assistant-inline">
              {renderMarkdown(content, { streaming: isStreaming })}
              {/* If we're drafting but the server hasn't pushed any content
                  yet (bridge finalises at end-of-turn), show a solo blinking
                  cursor so the user sees the agent is working. As soon as
                  content arrives this still renders inline thanks to the
                  cursor in renderMarkdown. */}
              {isStreaming && !content && (
                <span className="streaming-cursor" aria-hidden="true" />
              )}
            </div>
          </div>
        )
      }
      {message.status === 'done' && message.breadcrumbs && message.breadcrumbs.length > 0 && (
        <BreadcrumbStrip crumbs={message.breadcrumbs} active={false} />
      )}
      {(vaultFileIds.length > 0 || (message.sources && message.sources.length > 0)) && message.status === 'done' && (
        <div
          className="flex flex-wrap items-center gap-1.5 mt-2 pt-2.5"
          style={{ borderTop: '1px solid rgb(var(--hy-border) / 0.6)' }}
        >
          <span className="text-[11px] fg-muted mr-1">Referenced:</span>
          {vaultFileIds.map(id => <VaultCitationChip key={id} fileId={id} />)}
          {message.sources?.map(s => <SourceChip key={s.id} source={s} onOpen={onOpenSource} />)}
        </div>
      )}
      {/* Artifact chips — agent-emitted `[artifact type="..." title="..."]
          ...[/artifact]` blocks become clickable chips that open a
          side pane with the full content. Chat stays clean; long
          outputs (quotes, drafts, code) live in a dedicated pane. */}
      {message.status === 'done' && artifacts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {artifacts.map((a, i) => (
            <button
              key={i}
              onClick={() => onOpenArtifact?.(a)}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-left transition-colors focus-ring group/artifact hover:border-strong"
              style={{
                background: 'rgb(var(--hy-bg-subtle))',
                border: '1px solid rgb(var(--hy-border))',
                maxWidth: 360,
              }}
            >
              <FileText size={14} className="fg-subtle flex-shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] fg-base font-medium truncate">{a.title}</span>
                <span className="block text-[10.5px] fg-muted uppercase tracking-wider">{a.type}</span>
              </span>
              <span className="text-[11px] fg-muted group-hover/artifact:fg-base transition-colors">Open →</span>
            </button>
          ))}
        </div>
      )}
      {/* Suggested follow-ups — agent-emitted `[followup: ...]` tokens
          become clickable chips that send the suggestion as the next
          message. Max 3 per reply, shown only on done status. */}
      {message.status === 'done' && followups.length > 0 && onFollowup && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {followups.map((f, i) => (
            <button
              key={i}
              onClick={() => onFollowup(f)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] fg-subtle hover:fg-base transition-colors focus-ring"
              style={{
                background: 'rgb(var(--hy-bg-subtle))',
                border: '1px solid rgb(var(--hy-border))',
              }}
            >
              <span aria-hidden="true" className="opacity-60">→</span>
              {f}
            </button>
          ))}
        </div>
      )}
      {message.status === 'done' && (
        <div className="flex items-center gap-1 -ml-1 mt-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
          {onRetry && (
            <InlineAction
              icon={RefreshCw}
              label="Regenerate"
              onClick={() => onRetry(message.id)}
            />
          )}
          <InlineAction icon={ThumbsUp} label={rating === 'up' ? 'Thanks!' : 'Good'} onClick={() => setRating('up')} active={rating === 'up'} />
          <InlineAction icon={ThumbsDown} label={rating === 'down' ? 'Noted' : 'Bad'} onClick={() => setRating('down')} active={rating === 'down'} />
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * Memoised wrapper around AssistantBubbleInner. During streaming, only
 * the bubble for the active message should re-render each frame — the
 * tail of completed messages is effectively frozen. Keying on id +
 * content + status means a done message is never re-rendered.
 */
export const AssistantBubble = React.memo(
  AssistantBubbleInner,
  (prev, next) =>
    prev.message.id === next.message.id &&
    // Content identity drives the re-parse of artifacts / vault / followups /
    // plan inside the inner. Comparing content is the master signal.
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status &&
    // Breadcrumbs change during tool use — detect by length
    (prev.message.breadcrumbs?.length ?? 0) === (next.message.breadcrumbs?.length ?? 0) &&
    prev.streamingText === next.streamingText &&
    prev.isActive === next.isActive &&
    prev.onRetry === next.onRetry &&
    prev.onFollowup === next.onFollowup &&
    prev.onOpenSource === next.onOpenSource &&
    prev.onOpenArtifact === next.onOpenArtifact,
);

/**
 * Live trail of tool calls the agent has made while generating this reply.
 * - While the reply is in-flight (`active === true`): shows every crumb
 *   as a stacked one-liner with a pulsing dot on the latest. Users see
 *   what the agent is doing in real time (Reading customers.md → Running
 *   vault-search → Pulled jones-quote.txt).
 * - Once done: collapses to a single `▸ 3 steps` toggle the user can expand
 *   for the audit trail.
 *
 * The bridge emits crumbs via `extractBreadcrumbs` as the agent's tmux
 * pane streams. Each crumb is `{ kind: "Read" | "Bash" | "Search" | ...,
 * label: "<file or command summary>" }`.
 */
function BreadcrumbStrip({
  crumbs,
  active,
}: {
  crumbs?: Array<{ kind: string; label: string }>;
  /** True while the reply is still in-flight (pending/thinking/drafting).
   * Shows the latest crumb live; false = collapse into audit trail. */
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!crumbs || crumbs.length === 0) return null;

  // Live view: render the full trail with a pulsing dot on the last crumb.
  if (active) {
    return (
      <div className="flex flex-col gap-0.5 my-1.5">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const label = c.label.length > 80 ? c.label.slice(0, 80) + '…' : c.label;
          return (
            <div
              key={i}
              className="inline-flex items-center gap-2 text-[11.5px] fg-muted leading-tight"
              title={`${c.kind}: ${c.label}`}
            >
              <span
                className={cx(
                  'h-1.5 w-1.5 rounded-full flex-shrink-0',
                  isLast ? 'bg-current animate-pulse' : 'bg-current opacity-40',
                )}
              />
              <span className="font-medium fg-subtle">{c.kind}</span>
              <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>{label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Done view: one-line toggle that expands the audit trail on click.
  return (
    <div className="my-1.5">
      <button
        onClick={() => setExpanded(e => !e)}
        className="inline-flex items-center gap-1 text-[11px] fg-muted hover:fg-base transition-colors"
        aria-expanded={expanded}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {crumbs.length} {crumbs.length === 1 ? 'step' : 'steps'}
      </button>
      {expanded && (
        <div className="mt-1 pl-2 border-l-2 flex flex-col gap-0.5" style={{ borderColor: 'rgb(var(--hy-border))' }}>
          {crumbs.map((c, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-2 text-[11px] fg-muted leading-tight"
              title={`${c.kind}: ${c.label}`}
            >
              <span className="font-medium fg-subtle">{c.kind}</span>
              <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                {c.label.length > 80 ? c.label.slice(0, 80) + '…' : c.label}
              </span>
            </div>
          ))}
        </div>
      )}
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
