"use client";

import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Search, AtSign, Clock, ChevronRight, PencilLine, Sun, Settings,
  MessageSquare, Zap, Plus, Tag,
} from 'lucide-react';
import { cx, relativeTime } from '@/lib/chat/utils';
import type { Session, Source, MentionCustomer } from '@/lib/chat/types';
import IconButton from './IconButton';
import { iconForSource } from './Composer';
import { COMMANDS, MENTION_CUSTOMERS } from '@/lib/chat/mock';

/* ───────────── Source Slide-Over ───────────── */
interface SourceSlideOverProps { source: Source; onClose: () => void }

export function SourceSlideOver({ source, onClose }: SourceSlideOverProps) {
  const [tab, setTab] = useState(defaultTabFor(source.type));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabs = tabsFor(source.type);
  const IconC = iconForSource(source.type);

  return (
    <>
      <div className="overlay anim-fade-in" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 bg-surface border-l-hy anim-slide-in-right flex flex-col"
        style={{ width: 480, zIndex: 50, maxWidth: '90vw' }}
        role="dialog"
        aria-label={source.label}
      >
        <header className="h-14 px-5 border-b-hy flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgb(var(--hy-accent-subtle))', color: 'rgb(var(--hy-accent))' }}
            >
              <IconC size={15} />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium fg-base truncate">{source.label}</div>
              {source.sublabel && <div className="text-[11.5px] fg-muted truncate">{source.sublabel}</div>}
            </div>
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} size={15} />
        </header>
        <div className="flex items-center gap-1 px-4 pt-2 border-b-hy flex-shrink-0">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx(
                'px-3 py-2 text-[12px] font-medium transition-colors relative focus-ring rounded-t',
                tab === t ? 'fg-base' : 'fg-muted hover:fg-subtle'
              )}
            >
              {t}
              {tab === t && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-0.5"
                  style={{ background: 'rgb(var(--hy-accent))' }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          <SourceTabContent source={source} tab={tab} />
        </div>
      </div>
    </>
  );
}

function defaultTabFor(type: string): string {
  return ({
    contact: 'Overview', call: 'Summary', quote: 'Line items', job: 'Overview', invoice: 'Line items',
  } as Record<string, string>)[type] || 'Overview';
}

function tabsFor(type: string): string[] {
  return ({
    contact: ['Overview', 'Interactions', 'Tags'],
    call: ['Summary', 'Transcript', 'Raw'],
    quote: ['Line items', 'Timeline', 'Raw'],
    job: ['Overview', 'Timeline'],
    invoice: ['Line items', 'Timeline'],
  } as Record<string, string[]>)[type] || ['Overview'];
}

function SourceTabContent({ source, tab }: { source: Source; tab: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = source.details || {};
  if (source.type === 'contact') {
    if (tab === 'Overview') return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center text-[15px] font-semibold fg-inverse"
            style={{ background: 'rgb(var(--hy-accent))' }}
          >{d.name?.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</div>
          <div>
            <div className="text-[15px] font-medium fg-base">{d.name}</div>
            <div className="text-[12px] fg-muted">{`Last contact ${relativeTime(d.lastContact)}`}</div>
          </div>
        </div>
        <dl className="space-y-2 text-[13px]">
          <Field label="Phone" value={d.phone} />
          <Field label="Email" value={d.email} />
        </dl>
        <div>
          <div className="text-[11px] uppercase tracking-wider fg-muted mb-2 font-semibold">Tags</div>
          <div className="flex flex-wrap gap-1.5">
            {(d.tags || []).map((t: string) => (
              <span
                key={t}
                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-subtle fg-subtle"
              >{t}</span>
            ))}
          </div>
        </div>
      </div>
    );
    if (tab === 'Interactions') return (
      <ul className="space-y-3">
        {(d.interactions || []).map((it: { kind: string; note: string; when: string }, i: number) => (
          <li key={i} className="flex gap-3 text-[13px]">
            <div className="h-8 w-8 rounded-md bg-subtle flex items-center justify-center flex-shrink-0">
              <Clock size={13} className="fg-subtle" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium fg-base">{it.kind}</div>
              <div className="text-[12px] fg-subtle">{it.note}</div>
              <div
                className="text-[11px] fg-muted mt-0.5"
                style={{ fontFamily: 'var(--font-mono)' }}
              >{relativeTime(it.when)}</div>
            </div>
          </li>
        ))}
      </ul>
    );
    if (tab === 'Tags') return <TagsTab initialTags={d.tags || []} />;
  }

  if (source.type === 'call') {
    if (tab === 'Summary') return (
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          <Field label="Contact" value={d.contact} />
          <Field label="Duration" value={d.duration} />
          <Field label="Sentiment" value={d.sentiment} />
          <Field label="When" value={relativeTime(d.when)} />
        </dl>
        <div>
          <div className="text-[11px] uppercase tracking-wider fg-muted mb-2 font-semibold">Audio</div>
          <div className="flex items-center gap-2 p-3 rounded-md bg-subtle">
            <button
              className="h-8 w-8 rounded-full flex items-center justify-center fg-inverse flex-shrink-0"
              style={{ background: 'rgb(var(--hy-accent))' }}
              aria-label="Play"
            ><ChevronRight size={14} /></button>
            <div className="flex-1 flex items-center gap-[2px] h-8">
              {Array.from({ length: 48 }).map((_, i) => {
                const h = 8 + Math.abs(Math.sin(i * 0.6) * 18) + (i % 5) * 2;
                return (
                  <div
                    key={i}
                    style={{
                      width: 2,
                      height: h,
                      background: i < 14 ? 'rgb(var(--hy-accent))' : 'rgb(var(--hy-border-strong))',
                      borderRadius: 1,
                    }}
                  />
                );
              })}
            </div>
            <span className="text-[11px] fg-muted" style={{ fontFamily: 'var(--font-mono)' }}>2:41 / 9:14</span>
          </div>
        </div>
      </div>
    );
    if (tab === 'Transcript') return (
      <div className="space-y-3">
        {(d.transcript || []).map((line: { who: string; line: string }, i: number) => (
          <div key={i} className="text-[13px]">
            <span
              className="text-[11px] fg-muted mr-2"
              style={{ fontFamily: 'var(--font-mono)' }}
            >{line.who}</span>
            <span className="fg-base">{line.line}</span>
          </div>
        ))}
      </div>
    );
    if (tab === 'Raw') return (
      <pre
        className="text-[11.5px] fg-subtle bg-subtle rounded p-3 overflow-x-auto"
        style={{ fontFamily: 'var(--font-mono)' }}
      >{JSON.stringify(source, null, 2)}</pre>
    );
  }

  if (source.type === 'quote' || source.type === 'invoice') {
    if (tab === 'Line items') return (
      <div>
        <dl className="grid grid-cols-2 gap-3 text-[13px] mb-5">
          <Field label="Customer" value={d.customer} />
          <Field label="Total" value={d.total} />
          <Field label="Status" value={d.status} />
          {d.sent && <Field label="Sent" value={relativeTime(d.sent)} />}
        </dl>
        <div className="rounded-md border-hy overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: 'rgb(var(--hy-bg-subtle))' }}>
                {['Description', 'Qty', 'Price'].map(h => (
                  <th
                    key={h}
                    className="text-left px-3 py-2 text-[10.5px] uppercase tracking-wider fg-muted font-semibold"
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(d.lineItems || []).map((li: { desc: string; qty: string; price: string }, i: number) => (
                <tr key={i} style={{ borderTop: '1px solid rgb(var(--hy-border))' }}>
                  <td className="px-3 py-2 fg-base">{li.desc}</td>
                  <td className="px-3 py-2 fg-subtle" style={{ fontFamily: 'var(--font-mono)' }}>{li.qty}</td>
                  <td className="px-3 py-2 fg-base text-right" style={{ fontFamily: 'var(--font-mono)' }}>{li.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
    if (tab === 'Timeline') return <TimelineTab source={source} />;
    if (tab === 'Raw') return (
      <pre
        className="text-[11.5px] fg-subtle bg-subtle rounded p-3 overflow-x-auto"
        style={{ fontFamily: 'var(--font-mono)' }}
      >{JSON.stringify(source, null, 2)}</pre>
    );
  }

  if (source.type === 'job') {
    return (
      <div className="space-y-3">
        {(d.jobs || []).map((j: { customer: string; stage: string; days: number; value: string }, i: number) => (
          <div key={i} className="rounded-md border-hy p-3 flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium fg-base">{j.customer}</div>
              <div className="text-[11.5px] fg-muted">{`${j.stage} · ${j.days}d open`}</div>
            </div>
            <div className="text-[13px] fg-base" style={{ fontFamily: 'var(--font-mono)' }}>{j.value}</div>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

const PRESET_TAGS = ['Residential', 'Commercial', 'Fencing', 'Patio', 'Planting', 'Repeat', 'High value', 'Quote pending', 'Follow-up', 'VIP'];

function TagsTab({ initialTags }: { initialTags: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  const addTag = (t: string) => {
    const v = t.trim();
    if (!v || tags.includes(v)) return;
    setTags((prev) => [...prev, v]);
    setNewTag('');
    setAdding(false);
  };
  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));
  const available = PRESET_TAGS.filter((t) => !tags.includes(t));
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-wider fg-muted mb-2 font-semibold">Applied tags</div>
        {tags.length === 0
          ? <p className="text-[12.5px] fg-muted">No tags yet.</p>
          : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] bg-subtle fg-subtle">
                  <Tag size={10} />
                  {t}
                  <button onClick={() => removeTag(t)} className="ml-0.5 fg-muted hover:fg-base transition-colors" aria-label={`Remove ${t}`}>
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )
        }
      </div>
      {adding ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag(newTag);
              if (e.key === 'Escape') { setAdding(false); setNewTag(''); }
            }}
            placeholder="Tag name…"
            className="flex-1 rounded-md border-hy bg-surface px-3 py-1.5 text-[13px] fg-base outline-none focus:border-hy-strong"
          />
          <button onClick={() => addTag(newTag)} className="text-[12px] px-2.5 py-1.5 rounded-md fg-inverse font-medium" style={{ background: 'rgb(var(--hy-fg-base))' }}>Add</button>
          <button onClick={() => { setAdding(false); setNewTag(''); }} className="text-[12px] px-2 py-1.5 rounded-md fg-subtle hover:bg-hover">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-[12.5px] fg-subtle hover:fg-base transition-colors">
          <Plus size={13} />
          Add tag
        </button>
      )}
      {available.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider fg-muted mb-2 font-semibold">Suggestions</div>
          <div className="flex flex-wrap gap-1.5">
            {available.map((t) => (
              <button
                key={t}
                onClick={() => setTags((prev) => [...prev, t])}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11.5px] bg-surface border-hy fg-muted hover:fg-base hover:bg-hover transition-colors"
              >
                <Plus size={9} />
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineTab({ source }: { source: Source }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = source.details || {};
  type TimelineEvent = { when: string; kind: string; note: string };
  const events: TimelineEvent[] = d.interactions
    ? d.interactions.map((it: { when: string; kind: string; note: string }) => ({ when: it.when, kind: it.kind, note: it.note }))
    : source.type === 'quote' || source.type === 'invoice'
      ? [
          { when: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), kind: 'Created', note: `${source.label} created` },
          { when: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), kind: 'Sent', note: `Sent to ${d.customer || 'customer'}` },
          { when: new Date().toISOString(), kind: 'Viewed', note: 'Opened by recipient' },
        ]
      : source.type === 'job'
        ? [
            { when: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), kind: 'Job created', note: 'Added to pipeline' },
            { when: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), kind: 'Updated', note: 'Stage changed' },
          ]
        : [];
  if (events.length === 0) return <p className="text-[12.5px] fg-muted">No events recorded.</p>;
  return (
    <ol className="relative space-y-4 pl-4" style={{ borderLeft: '2px solid rgb(var(--hy-border))' }}>
      {[...events].reverse().map((ev, i) => (
        <li key={i} className="relative pl-4">
          <span
            className="absolute -left-[13px] top-1 h-2.5 w-2.5 rounded-full border-2"
            style={{ background: 'rgb(var(--hy-accent))', borderColor: 'rgb(var(--hy-bg-surface))' }}
          />
          <div className="text-[11px] fg-muted mb-0.5" style={{ fontFamily: 'var(--font-mono)' }}>{relativeTime(ev.when)}</div>
          <div className="text-[13px] fg-base font-medium">{ev.kind}</div>
          <div className="text-[12px] fg-subtle">{ev.note}</div>
        </li>
      ))}
    </ol>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-wider fg-muted font-semibold mb-0.5">{label}</dt>
      <dd className="fg-base">{value}</dd>
    </div>
  );
}

/* ───────────── Command Palette ───────────── */
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onToggleTheme: () => void;
  onSend: (text: string) => void;
  currentSession?: Session | null;
}

const COMMAND_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Zap, MessageSquare, Search, Settings, Sun, PencilLine,
};

interface PaletteItem {
  id: string;
  section: string;
  label: string;
  sub?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  kbd?: string;
  onRun: () => void;
}

export function CommandPalette({ open, onClose, sessions, onSelectSession, onNewChat, onToggleTheme, currentSession }: CommandPaletteProps) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) { setQ(''); setIdx(0); }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const exportSession = (sess: Session | null | undefined) => {
      if (!sess) return;
      const md = sess.messages.map(m =>
        `**${m.role === 'user' ? 'You' : 'Nexley'}** (${new Date(m.createdAt).toLocaleString()}):\n\n${m.content}`
      ).join('\n\n---\n\n');
      const blob = new Blob([`# ${sess.title}\n\n${md}`], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sess.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    const actions: PaletteItem[] = [
      { id: 'new', section: 'Suggested', label: 'New chat', icon: PencilLine, kbd: '⌘N', onRun: onNewChat },
      { id: 'theme', section: 'Suggested', label: 'Toggle theme', icon: Sun, kbd: '⌘.', onRun: onToggleTheme },
      { id: 'settings', section: 'Suggested', label: 'Settings', icon: Settings, onRun: () => { window.location.href = '/settings'; } },
    ];
    const recent: PaletteItem[] = sessions.slice(0, 5).map(s => ({
      id: s.id, section: 'Recent sessions', label: s.title,
      icon: MessageSquare, onRun: () => onSelectSession(s.id),
    }));
    const cmdHandlers: Record<string, () => void> = {
      'cmd-refine': () => { /* palette closes; user clicks Improve in composer */ },
      'cmd-export': () => exportSession(currentSession),
      'cmd-clear': onNewChat,
      'cmd-history': () => { /* palette IS the history search */ },
    };
    const cmds: PaletteItem[] = (COMMANDS || []).map(c => ({
      id: c.id, section: 'Commands', label: c.label, sub: c.sub,
      icon: COMMAND_ICON_MAP[c.icon] || Zap, onRun: cmdHandlers[c.id] ?? (() => {}),
    }));
    const all = [...actions, ...recent, ...cmds];
    if (!q.trim()) return all;
    const ql = q.toLowerCase();
    return all.filter(a =>
      a.label.toLowerCase().includes(ql) || (a.sub || '').toLowerCase().includes(ql)
    );
  }, [q, sessions, onNewChat, onToggleTheme, onSelectSession]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[idx];
        if (it) { it.onRun(); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, idx, onClose]);

  if (!open) return null;

  const grouped = items.reduce<Record<string, PaletteItem[]>>((acc, it) => {
    (acc[it.section] = acc[it.section] || []).push(it);
    return acc;
  }, {});
  let runningIdx = -1;

  return (
    <>
      <div className="overlay anim-fade-in" onClick={onClose} style={{ zIndex: 60 }} />
      <div
        className="fixed left-1/2 top-1/2 rounded-2xl border-hy bg-surface anim-fade-scale-in flex flex-col"
        style={{
          transform: 'translate(-50%, -50%)',
          width: 640,
          maxWidth: '92vw',
          maxHeight: '70vh',
          zIndex: 70,
          boxShadow: '0 20px 60px rgb(0 0 0 / 0.35)',
        }}
        role="dialog"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b-hy">
          <Search size={16} className="fg-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none text-[14px] fg-base placeholder:fg-muted"
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="overflow-y-auto scroll-thin p-2">
          {Object.entries(grouped).map(([section, arr]) => (
            <div key={section} className="mb-1">
              <div className="text-[10.5px] uppercase tracking-wider fg-muted px-2 pt-2 pb-1 font-semibold">{section}</div>
              {arr.map(it => {
                runningIdx++;
                const active = runningIdx === idx;
                const IconC = it.icon;
                return (
                  <button
                    key={it.id}
                    onMouseEnter={() => setIdx(items.indexOf(it))}
                    onClick={() => { it.onRun(); onClose(); }}
                    className={cx(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors',
                      active ? 'bg-subtle' : 'hover:bg-hover'
                    )}
                  >
                    <IconC size={14} className="fg-subtle flex-shrink-0" />
                    <span className="text-[13px] fg-base flex-1 truncate">{it.label}</span>
                    {it.sub && <span className="text-[11.5px] fg-muted truncate">{it.sub}</span>}
                    {it.kbd && <span className="kbd">{it.kbd}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] fg-muted">No matches</div>
          )}
        </div>
      </div>
    </>
  );
}

/* ───────────── Mention Menu ───────────── */
interface MentionMenuProps {
  open: boolean;
  onClose: () => void;
  onPick: (customer: MentionCustomer) => void;
}

export function MentionMenu({ open, onClose, onPick }: MentionMenuProps) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  if (!open) return null;
  const list = (MENTION_CUSTOMERS || []).filter(c =>
    !q.trim() || c.name.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <>
      <div className="overlay anim-fade-in" onClick={onClose} style={{ zIndex: 60 }} />
      <div
        className="fixed left-1/2 top-1/2 rounded-2xl border-hy bg-surface anim-fade-scale-in"
        style={{
          transform: 'translate(-50%, -50%)',
          width: 420,
          maxWidth: '92vw',
          zIndex: 70,
          boxShadow: '0 20px 60px rgb(0 0 0 / 0.35)',
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b-hy">
          <AtSign size={14} className="fg-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Reference a customer…"
            className="flex-1 bg-transparent outline-none text-[13px] fg-base placeholder:fg-muted"
          />
        </div>
        <div className="p-1 max-h-72 overflow-y-auto scroll-thin">
          {list.map(c => (
            <button
              key={c.id}
              onClick={() => { onPick(c); onClose(); }}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-hover text-left transition-colors"
            >
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[10.5px] font-semibold fg-inverse"
                style={{ background: 'rgb(var(--hy-accent))' }}
              >{c.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] fg-base truncate">{c.name}</div>
                <div className="text-[11.5px] fg-muted truncate">{c.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
