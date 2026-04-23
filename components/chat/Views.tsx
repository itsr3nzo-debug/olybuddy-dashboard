"use client";

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Folder, FileText, Users, Sparkles, Search,
  Zap, Activity, Check, Plus, Pin, MoreHorizontal,
  AtSign, Command as CommandIcon, Sun, Moon,
} from 'lucide-react';
import { cx, relativeTime } from '@/lib/chat/utils';
import type { Session, Source, Suggestion, Workflow } from '@/lib/chat/types';
import { useClient } from '@/lib/chat/client-context';
import Composer, { UserBubble, AssistantBubble } from './Composer';
import IconButton from './IconButton';
import { VoicePill } from './Features';

/* ───────────── Chat shell ───────────── */
function BrowserChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/* ───────────── Client pin ───────────── */
function ClientPin() {
  const { clientName } = useClient();
  const initials = clientName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || 'N';
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] fg-subtle whitespace-nowrap"
      style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
    >
      <span
        className="h-3.5 w-3.5 rounded-sm flex items-center justify-center text-[7.5px] font-semibold flex-shrink-0"
        style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
      >{initials}</span>
      {clientName}
      <span className="fg-muted">·</span>
      This quarter
    </div>
  );
}

/* ───────────── Tip carousel ───────────── */
const TIP_ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Command: CommandIcon, AtSign, Sparkles, Zap,
};

const TIPS = [
  { key: 'palette', icon: 'Command', text: 'Press ⌘K to jump between sources, prompts, and threads' },
  { key: 'mention', icon: 'AtSign', text: 'Type @ to reference a contact, job, or invoice inline' },
  { key: 'refine', icon: 'Sparkles', text: 'Improve rewrites your prompt for a clearer answer' },
  { key: 'workflow', icon: 'Zap', text: 'Workflows chain prompts — pick one to run through a sequence' },
];

function TipCarousel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % TIPS.length), 5000);
    return () => clearInterval(t);
  }, []);
  const tip = TIPS[i];
  const IconC = TIP_ICON_MAP[tip.icon] || Sparkles;
  return (
    <div key={tip.key} className="flex items-center justify-center gap-2 text-[11.5px] fg-muted anim-fade-in">
      <IconC size={11} />
      <span>{tip.text}</span>
    </div>
  );
}

/* ───────────── Avatar stack ───────────── */
function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="inline-flex items-center mr-1.5">
      {names.slice(0, 3).map((n, i) => (
        <span
          key={i}
          className="inline-flex items-center justify-center rounded-full text-[7px] font-semibold"
          style={{
            width: 16, height: 16,
            marginLeft: i === 0 ? 0 : -6,
            background: 'rgb(var(--hy-bg-subtle))',
            color: 'rgb(var(--hy-fg-subtle))',
            border: '1.5px solid rgb(var(--hy-bg-app))',
            zIndex: names.length - i,
            letterSpacing: '-0.03em',
          }}
        >{n}</span>
      ))}
    </span>
  );
}

/* ───────────── Chip defs and source chip row ───────────── */
const CHIP_ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Folder, FileText,
};

interface ChipDef {
  id: string;
  dot?: string;
  icon?: string;
  label: string;
  detail: string;
}

const CHIP_DEFS: ChipDef[] = [
  { id: 'crm', dot: 'dot-crm', label: 'CRM', detail: '3,241 contacts' },
  { id: 'calls', dot: 'dot-calls', label: 'Call log', detail: 'Last 90 days' },
  { id: 'quotes', dot: 'dot-invoices', label: 'Quotes', detail: '214 documents' },
  { id: 'calendar', dot: 'dot-calendar', label: 'Calendar', detail: 'Crew + sales' },
  { id: 'web', dot: 'dot-web', label: 'Web', detail: 'Live search' },
  { id: 'vault', icon: 'Folder', label: 'Your Vault', detail: '118 files' },
  { id: 'invoices', icon: 'FileText', label: 'Past invoices', detail: 'FY24 + FY25' },
];

function SourceChipRow({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {CHIP_DEFS.map((c) => {
        const on = selected.has(c.id);
        const IconC = c.icon ? (CHIP_ICON_MAP[c.icon] || Folder) : null;
        return (
          <button
            key={c.id}
            onClick={() => onToggle(c.id)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md px-2 h-7 text-[11.5px] transition-colors focus-ring whitespace-nowrap',
              on ? 'fg-base' : 'fg-subtle hover:fg-base'
            )}
            style={{
              background: on ? 'rgb(var(--hy-bg-subtle))' : 'rgb(var(--hy-bg-surface))',
              border: `1px solid rgb(var(--hy-border)${on ? '-strong' : ''})`,
              borderColor: on ? 'rgb(var(--hy-border-strong))' : 'rgb(var(--hy-border))',
            }}
          >
            {c.dot
              ? <span className={'dot ' + c.dot} />
              : IconC ? <IconC size={11} /> : null}
            {c.label}
            {on
              ? <Check size={11} className="fg-base ml-0.5" />
              : <Plus size={10} className="fg-muted" />}
          </button>
        );
      })}
    </div>
  );
}

function ApplyBar({ selected, onClear }: { selected: Set<string>; onClear: () => void }) {
  if (selected.size === 0) return null;
  const chips = CHIP_DEFS.filter((c) => selected.has(c.id));
  return (
    <div
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] anim-fade-in"
      style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
    >
      <span className="fg-muted">{`Searching across ${selected.size}:`}</span>
      <span className="flex items-center gap-1 flex-wrap fg-subtle">
        {chips.map((c, i) => {
          const IconC = c.icon ? (CHIP_ICON_MAP[c.icon] || Folder) : null;
          return (
            <span key={c.id} className="inline-flex items-center gap-1">
              {c.dot
                ? <span className={'dot ' + c.dot} />
                : IconC ? <IconC size={10} /> : null}
              {c.label}
              {i < chips.length - 1 && <span className="fg-muted">·</span>}
            </span>
          );
        })}
      </span>
      <div className="flex-1" />
      <button onClick={onClear} className="fg-muted hover:fg-base transition-colors">Clear</button>
    </div>
  );
}

/* ───────────── Workflow cell ───────────── */
const WORKFLOW_STEPS: Record<number, string[]> = {
  0: ['Pull open jobs from CRM', 'Cross-check crew calendar', 'Flag blockers', 'Draft status note', 'Send to ops'],
  1: ['Find unpaid invoices >30d', 'Load contact history', 'Draft chase email', 'Schedule follow-up', 'Log in CRM'],
  2: ['Pull missed calls', 'Match to CRM contacts', 'Draft callback script', 'Create reminders'],
  3: ['Extract quote line items', 'Check margin vs template', 'Flag anomalies', 'Summarize for approval'],
};

function WorkflowCell({ w, i, last }: { w: Workflow; i: number; last: boolean }) {
  const [hover, setHover] = useState(false);
  const steps = WORKFLOW_STEPS[i] || [];
  const dotColors = ['rgb(var(--dot-crm))', 'rgb(var(--dot-invoices))', 'rgb(var(--dot-calls))', 'rgb(var(--dot-calendar))'];
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-left px-4 py-3.5 transition-colors focus-ring group relative"
      style={!last ? { borderRight: '1px solid rgb(var(--hy-border))' } : undefined}
    >
      <p
        className="text-[12.5px] fg-base leading-snug pr-6"
        style={{ fontWeight: 400, minHeight: 34 }}
      >{w.title}</p>
      {!hover && (
        <div className="mt-4 flex items-center gap-2 text-[10.5px] fg-muted">
          <span className="inline-flex items-center gap-1">
            <Zap size={10} />
            {w.kind}
          </span>
          <span>{`${w.steps} steps`}</span>
        </div>
      )}
      {hover && (
        <ol
          className="mt-3 space-y-0.5 text-[10.5px] fg-subtle anim-fade-in"
          style={{ listStyle: 'none', paddingLeft: 0 }}
        >
          {steps.slice(0, 3).map((s, si) => (
            <li key={si} className="flex items-start gap-1.5">
              <span className="fg-muted flex-shrink-0" style={{ width: 8 }}>{`${si + 1}.`}</span>
              <span className="truncate">{s}</span>
            </li>
          ))}
          {steps.length > 3 && <li className="fg-muted pl-3.5">{`+${steps.length - 3} more`}</li>}
        </ol>
      )}
      <span
        className="absolute bottom-3 right-3"
        style={{
          width: 12, height: 12, borderRadius: 2,
          background: dotColors[i] || 'rgb(var(--hy-fg-muted))',
          opacity: 0.45,
        }}
      />
    </button>
  );
}

/* ───────────── Heartbeat card ───────────── */
function HeartbeatCard() {
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[10.5px] fg-muted uppercase tracking-wider inline-flex items-center gap-1.5">
          <Activity size={10} />
          Nexley this week
        </div>
        <button className="text-[10.5px] fg-muted hover:fg-base transition-colors inline-flex items-center gap-1">
          Open report
          <ChevronRight size={10} />
        </button>
      </div>
      <div className="heartbeat-card">
        <div className="heartbeat-cell">
          <div className="heartbeat-num">4</div>
          <div className="heartbeat-label">nudges drafted</div>
          <div className="heartbeat-sub">£13.2k at stake</div>
        </div>
        <div className="heartbeat-cell">
          <div className="heartbeat-num">2</div>
          <div className="heartbeat-label">overdue invoices flagged</div>
          <div className="heartbeat-sub">£3,480 total</div>
        </div>
        <div className="heartbeat-cell">
          <div className="heartbeat-num">6</div>
          <div className="heartbeat-label">silent customers found</div>
          <div className="heartbeat-sub">30+ days</div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Dashboard ───────────── */
interface DashboardProps {
  suggestions: Suggestion[];
  workflows: Workflow[];
  onSend: (text: string) => void;
  onOpenPalette: () => void;
  onOpenMention: () => void;
  pendingMention?: string | null;
  onMentionConsumed?: () => void;
}

function timeAwareGreeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({ onSend, onOpenPalette, onOpenMention, workflows, pendingMention, onMentionConsumed }: DashboardProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(['crm', 'calls']));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <BrowserChrome>
      <div className="h-full overflow-y-auto scroll-thin relative">
        <div className="mx-auto px-8 pt-16 pb-8 flex flex-col" style={{ maxWidth: 680 }}>
          {/* Hero — tighter, with time-aware greeting */}
          <div className="text-center mb-8">
            <div
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 34,
                fontWeight: 500,
                letterSpacing: '-0.02em',
                lineHeight: 1.0,
              }}
              className="fg-base mb-2.5"
            >
              {timeAwareGreeting()}
            </div>
            <div className="flex justify-center">
              <ClientPin />
            </div>
          </div>

          <Composer
            variant="hero"
            autoFocus
            onSend={onSend}
            onOpenPalette={onOpenPalette}
            onOpenMention={onOpenMention}
            busy={false}
            pendingMention={pendingMention}
            onMentionConsumed={onMentionConsumed}
          />

          {/* One unified control row: sources + voice on one line */}
          <div className="mt-3 flex items-center justify-between gap-3 px-1">
            <SourceChipRow selected={selected} onToggle={toggle} />
            <VoicePill />
          </div>

          {/* Searching-across summary — only when sources are actually selected */}
          {selected.size > 0 && (
            <div className="mt-1.5">
              <ApplyBar selected={selected} onClear={() => setSelected(new Set())} />
            </div>
          )}

          {/* HeartbeatCard — the "what your AI did" signal, kept prominent */}
          <HeartbeatCard />

          {/* Workflows — now inside the main column so widths align */}
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-[11.5px] fg-muted uppercase tracking-wider">Recommended workflows</h3>
              <div className="flex items-center gap-4 text-[11.5px] fg-muted">
                <button className="inline-flex items-center gap-1 hover:fg-base transition-colors">
                  <Search size={11} />
                  Search
                </button>
                <button className="hover:fg-base transition-colors">View all</button>
              </div>
            </div>
            <div className="grid grid-cols-2" style={{ borderTop: '1px solid rgb(var(--hy-border))' }}>
              {workflows.slice(0, 4).map((w, i) => (
                <WorkflowCell key={i} w={w} i={i} last={i === 3} />
              ))}
            </div>
          </div>

          {/* Single static hint at the very bottom — no auto-rotating carousel */}
          <div className="mt-8 flex items-center justify-center gap-1.5 text-[11px] fg-muted opacity-70">
            <CommandIcon size={11} />
            <span>Press ⌘K to jump between sources, prompts, and threads</span>
          </div>
        </div>
      </div>
    </BrowserChrome>
  );
}

/* ───────────── AssistPanel ───────────── */
interface AssistPanelProps {
  session: Session;
  onSend: (text: string) => void;
  onOpenSource: (src: Source) => void;
  streamingText: string;
  busy: boolean;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onOpenMention: () => void;
  onOpenPalette: () => void;
  pendingMention?: string | null;
  onMentionConsumed?: () => void;
}

export function AssistPanel({ session, onSend, onOpenSource, streamingText, busy, onOpenMention, onOpenPalette, onRenameSession, onDeleteSession, onPinSession, pendingMention, onMentionConsumed }: AssistPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');

  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    const id = setTimeout(() => window.addEventListener('click', close, { once: true }));
    return () => { clearTimeout(id); window.removeEventListener('click', close); };
  }, [moreOpen]);

  const commitRename = () => {
    if (renameVal.trim()) onRenameSession(session.id, renameVal.trim());
    setRenaming(false);
  };

  const exportSession = () => {
    const md = session.messages.map(m =>
      `**${m.role === 'user' ? 'You' : 'Nexley'}** (${new Date(m.createdAt).toLocaleString()}):\n\n${m.content}`
    ).join('\n\n---\n\n');
    const blob = new Blob([`# ${session.title}\n\n${md}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!scrollRef.current || !autoScroll) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages, streamingText, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  if (!session) return null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-6 py-3 flex items-center gap-2 border-b-hy flex-shrink-0">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
              className="w-full text-[13px] fg-base font-medium bg-surface border-hy rounded px-2 py-0.5 outline-none"
            />
          ) : (
            <div className="text-[13px] fg-base truncate font-medium" title={session.title}>{session.title}</div>
          )}
          <div className="text-[10.5px] fg-muted">
            {relativeTime(session.updatedAt ?? session.createdAt)}
            {' · '}
            {session.messages.length}
            {' messages'}
          </div>
        </div>
        <IconButton
          icon={Pin}
          label={session.pinned ? 'Unpin' : 'Pin'}
          size={12}
          onClick={() => onPinSession?.(session.id, !session.pinned)}
          active={session.pinned}
        />
        <div className="relative">
          <IconButton
            icon={MoreHorizontal}
            label="More"
            size={13}
            onClick={(e) => { e.stopPropagation(); setMoreOpen((o) => !o); }}
          />
          {moreOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 w-40 rounded-md border-hy bg-surface anim-fade-in z-20 py-1"
              style={{ boxShadow: '0 10px 24px rgb(0 0 0 / 0.2)' }}
            >
              {([
                { label: 'Rename', action: () => { setRenameVal(session.title); setRenaming(true); setMoreOpen(false); } },
                { label: session.pinned ? 'Unpin' : 'Pin', action: () => { onPinSession?.(session.id, !session.pinned); setMoreOpen(false); } },
                { label: 'Export', action: () => { exportSession(); setMoreOpen(false); } },
                { label: 'Delete', action: () => { onDeleteSession?.(session.id); setMoreOpen(false); }, danger: true },
              ] as Array<{ label: string; action: () => void; danger?: boolean }>).map((it, i) => (
                <button
                  key={i}
                  onClick={it.action}
                  className={cx('w-full flex items-center px-3 py-1.5 text-[12px] hover:bg-hover transition-colors text-left', it.danger ? 'fg-danger' : 'fg-subtle')}
                >{it.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto scroll-thin"
      >
        <div className="mx-auto w-full max-w-[780px] px-6 py-8 space-y-6">
          {session.messages.map((m) =>
            m.role === 'user'
              ? <UserBubble key={m.id} message={m} />
              : <AssistantBubble
                  key={m.id}
                  message={m}
                  onOpenSource={onOpenSource}
                  streamingText={streamingText}
                  isActive={m.status === 'drafting'}
                />
          )}
        </div>
      </div>
      <div className="border-t-hy flex-shrink-0 bg-app">
        <div className="mx-auto w-full max-w-[780px] px-6 py-4">
          <Composer variant="panel" sessionId={session.id} onSend={onSend} onOpenPalette={onOpenPalette} onOpenMention={onOpenMention} busy={busy} pendingMention={pendingMention} onMentionConsumed={onMentionConsumed} />
        </div>
      </div>
    </div>
  );
}

