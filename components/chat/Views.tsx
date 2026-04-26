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

function WorkflowCell({ w, i, last: _last, onRun }: { w: Workflow; i: number; last: boolean; onRun?: (prompt: string) => void }) {
  void _last; // kept in signature for backward compat
  const [hover, setHover] = useState(false);
  const steps = WORKFLOW_STEPS[i] || [];
  const dotColors = ['rgb(var(--dot-crm))', 'rgb(var(--dot-invoices))', 'rgb(var(--dot-calls))', 'rgb(var(--dot-calendar))'];
  // Building the actual prompt from the workflow's title + steps list so the
  // agent has everything it needs (was: dead click with no onClick at all).
  const handleRun = () => {
    if (!onRun) return;
    const stepList = steps.length > 0 ? '\n- ' + steps.join('\n- ') : '';
    onRun(`Run the "${w.title}" workflow:${stepList}`);
  };
  // Border calc for a 2x2 grid:
  //   - Left column (i % 2 === 0): right border to separate from right column
  //   - Right column: no right border
  //   - Bottom row (i >= 2): top border to separate from top row
  // Container provides borderTop for the very first row.
  const isLeftCol = i % 2 === 0;
  const isBottomRow = i >= 2;
  const cellBorder: React.CSSProperties = {
    borderRight: isLeftCol ? '1px solid rgb(var(--hy-border))' : undefined,
    borderTop: isBottomRow ? '1px solid rgb(var(--hy-border))' : undefined,
  };
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={handleRun}
      className="text-left px-4 py-3.5 transition-colors focus-ring group relative hover:bg-hover cursor-pointer"
      style={cellBorder}
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

/* ───────────── Heartbeat card — real agent_actions data ─────────────
 * Previously the three cells rendered hardcoded values ("4 nudges drafted,
 * £13.2k at stake", etc.) regardless of actual activity. Now it fetches the
 * last 7 days of agent_actions for the current client and aggregates into
 * three honest counts. Falls back to the "getting started" message when the
 * client is new (zero actions logged yet) rather than lying about activity. */
function HeartbeatCard() {
  const { clientId } = useClient();
  const [stats, setStats] = useState<{ nudges: number; nudgeValue: number; overdue: number; overdueTotal: number; silent: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('agent_actions')
        .select('category, value_gbp, meta, occurred_at')
        .eq('client_id', clientId)
        .gte('occurred_at', since)
        .limit(500);
      if (!alive) return;
      const rows = data ?? [];
      const nudgeCats = new Set(['follow_up_sent', 'quote_chased', 'review_requested']);
      const overdueCats = new Set(['quote_chased', 'invoice_chased']);
      const silentCats = new Set(['dormant_revival_nudge', 'database_reactivation']);
      let nudges = 0, nudgeValue = 0, overdue = 0, overdueTotal = 0, silent = 0;
      for (const r of rows) {
        const c = r.category as string;
        const v = (r.value_gbp as number | null) ?? 0;
        if (nudgeCats.has(c)) { nudges++; nudgeValue += v; }
        if (overdueCats.has(c)) { overdue++; overdueTotal += v; }
        if (silentCats.has(c)) silent++;
      }
      setStats({ nudges, nudgeValue, overdue, overdueTotal, silent });
      setLoading(false);
    })().catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clientId]);

  const fmtGBP = (pence: number) => {
    if (pence === 0) return '£0';
    if (pence >= 1000) return '£' + (pence / 1000).toFixed(1) + 'k';
    return '£' + pence.toLocaleString('en-GB');
  };

  const hasActivity = stats && (stats.nudges + stats.overdue + stats.silent) > 0;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-[10.5px] fg-muted uppercase tracking-wider inline-flex items-center gap-1.5">
          <Activity size={10} />
          Nexley this week
        </div>
        <a
          href="/admin/close"
          className="text-[10.5px] fg-muted hover:fg-base transition-colors inline-flex items-center gap-1"
        >
          Open report
          <ChevronRight size={10} />
        </a>
      </div>
      <div className="heartbeat-card">
        <div className="heartbeat-cell">
          <div className="heartbeat-num">{loading ? '—' : (stats?.nudges ?? 0)}</div>
          <div className="heartbeat-label">nudges drafted</div>
          <div className="heartbeat-sub">{loading ? ' ' : (hasActivity ? fmtGBP(stats!.nudgeValue) + ' at stake' : 'last 7 days')}</div>
        </div>
        <div className="heartbeat-cell">
          <div className="heartbeat-num">{loading ? '—' : (stats?.overdue ?? 0)}</div>
          <div className="heartbeat-label">overdue invoices flagged</div>
          <div className="heartbeat-sub">{loading ? ' ' : (hasActivity ? fmtGBP(stats!.overdueTotal) + ' total' : 'last 7 days')}</div>
        </div>
        <div className="heartbeat-cell">
          <div className="heartbeat-num">{loading ? '—' : (stats?.silent ?? 0)}</div>
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
              {/* Prior "Search" and "View all" buttons were decorative with no
                  onClick handlers — removed rather than leaving dead buttons.
                  Command palette (⌘K) covers the search need. */}
            </div>
            <div className="grid grid-cols-2" style={{ borderTop: '1px solid rgb(var(--hy-border))' }}>
              {workflows.slice(0, 4).map((w, i) => (
                <WorkflowCell key={i} w={w} i={i} last={i === 3} onRun={onSend} />
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
  /** Realtime websocket state — drives the "reconnecting" pill in the header. */
  rtStatus?: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  /** True while the initial message-list fetch is in flight for this session. */
  loadingMessages?: boolean;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onOpenMention: () => void;
  onOpenPalette: () => void;
  pendingMention?: string | null;
  onMentionConsumed?: () => void;
  /** Fired when the user clicks "Try again" on an errored assistant reply. */
  onRetryMessage?: (assistantMessageId: string) => void;
  /** Fired when the user clicks a suggested follow-up chip. */
  onFollowup?: (text: string) => void;
  /** Fired when the user clicks Stop during an in-flight reply. */
  onCancel?: () => void;
  /** Fired when the user clicks Edit on their own past message — parent
   * truncates the thread at that point + preloads composer with the
   * message content for re-submission. */
  onEditMessage?: (messageId: string, content: string) => void;
  /** One-shot draft text — Composer replaces its value with this once
   * (used for Edit & resend), then calls onDraftConsumed to clear. */
  pendingDraft?: string | null;
  onDraftConsumed?: () => void;
  /** Fired when the user clicks an artifact chip — parent opens a side
   * pane showing the full artifact body with copy/export actions. */
  onOpenArtifact?: (artifact: import('./Composer').ChatArtifact) => void;
}

export function AssistPanel({ session, onSend, onOpenSource, streamingText, busy, rtStatus, loadingMessages, onOpenMention, onOpenPalette, onRenameSession, onDeleteSession, onPinSession, pendingMention, onMentionConsumed, onRetryMessage, onFollowup, onCancel, onEditMessage, pendingDraft, onDraftConsumed, onOpenArtifact }: AssistPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  // ⌘F in-chat search — opens a thin search bar at the top of the scroll
  // area. Matches across all message content (user + assistant). Up/Down
  // arrow navigates hits; Esc closes.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);
  // Compute which message-ids match the current query. Cheap for <500
  // messages; we bail out if the query is <2 chars.
  const searchHits = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [] as string[];
    return session.messages
      .filter(m => m.content?.toLowerCase().includes(q))
      .map(m => m.id);
  }, [searchQuery, session.messages]);
  useEffect(() => {
    // Reset cursor when hits change; scroll to the first hit.
    if (searchHits.length > 0) setSearchIdx(0);
  }, [searchHits.length]);
  useEffect(() => {
    const target = searchHits[searchIdx];
    if (!target) return;
    const el = document.querySelector(`[data-message-id="${target}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [searchIdx, searchHits]);

  // Two-step delete confirm for the header "More" menu — same pattern as the
  // sidebar's SessionItem so delete can't happen on a single stray click.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(t);
  }, [deleteArmed]);
  useEffect(() => {
    if (!moreOpen) setDeleteArmed(false);
  }, [moreOpen]);

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
    <div className="h-full flex flex-col min-h-0 relative">
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
            <div className="text-[13px] fg-base truncate font-medium flex items-center gap-2" title={session.title}>
              <span className="truncate">{session.title}</span>
              {/* Reconnecting pill — shown only when the realtime socket is
                  disconnected AND there's an in-flight assistant message.
                  Otherwise it's noise: healthy closed-but-idle looks bad. */}
              {(rtStatus === 'closed' || rtStatus === 'error') &&
                session.messages.some(
                  (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'thinking' || m.status === 'drafting')
                ) && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-hover fg-muted flex-shrink-0"
                    title="Realtime connection dropped — polling for updates"
                  >
                    <span className="h-1 w-1 rounded-full bg-current opacity-60 animate-pulse" />
                    Reconnecting…
                  </span>
                )}
            </div>
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
                {
                  label: deleteArmed ? 'Click again to delete' : 'Delete',
                  danger: true,
                  action: () => {
                    if (!deleteArmed) { setDeleteArmed(true); return; }
                    onDeleteSession?.(session.id);
                    setMoreOpen(false);
                    setDeleteArmed(false);
                  },
                },
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
      {/* ⌘F in-chat search — thin bar above the scroll area. Arrow keys
          cycle hits, Esc closes. */}
      {searchOpen && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b-hy flex-shrink-0 anim-fade-in"
          style={{ background: 'rgb(var(--hy-bg-subtle))' }}
        >
          <input
            autoFocus
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchHits.length > 0) {
                e.preventDefault();
                setSearchIdx((i) => (e.shiftKey
                  ? (i - 1 + searchHits.length) % searchHits.length
                  : (i + 1) % searchHits.length));
              } else if (e.key === 'Escape') {
                setSearchOpen(false);
                setSearchQuery('');
              }
            }}
            placeholder="Search this chat…"
            className="flex-1 bg-transparent outline-none text-[13px] fg-base placeholder:fg-muted"
            aria-label="Search within this chat"
          />
          {searchQuery.length >= 2 && (
            <span className="text-[11.5px] fg-muted">
              {searchHits.length === 0 ? 'No matches' : `${searchIdx + 1} of ${searchHits.length}`}
            </span>
          )}
          <button
            onClick={() => setSearchIdx((i) => (i - 1 + Math.max(1, searchHits.length)) % Math.max(1, searchHits.length))}
            disabled={searchHits.length === 0}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-hover fg-subtle disabled:opacity-40"
            aria-label="Previous match"
          >↑</button>
          <button
            onClick={() => setSearchIdx((i) => (i + 1) % Math.max(1, searchHits.length))}
            disabled={searchHits.length === 0}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-hover fg-subtle disabled:opacity-40"
            aria-label="Next match"
          >↓</button>
          <button
            onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-hover fg-subtle"
            aria-label="Close search"
          >×</button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto scroll-thin relative"
      >
        <div className="mx-auto w-full max-w-[780px] px-6 py-8 space-y-6">
          {/* Skeleton while the initial message list is loading. Shimmer
              gradient instead of plain opacity pulse — matches Linear AI. */}
          {loadingMessages && session.messages.length === 0 && (
            <div className="space-y-4" aria-label="Loading chat history" aria-live="polite">
              {[72, 120, 88].map((w, i) => (
                <div key={i} className="h-3 rounded anim-skeleton" style={{ width: `${w}%` }} />
              ))}
              <div className="h-6" />
              {[60, 96, 40].map((w, i) => (
                <div key={`b-${i}`} className="h-3 rounded anim-skeleton" style={{ width: `${w}%`, marginLeft: 'auto' }} />
              ))}
            </div>
          )}
          {session.messages.map((m) =>
            m.role === 'user'
              ? <UserBubble key={m.id} message={m} onEdit={onEditMessage} />
              : <AssistantBubble
                  key={m.id}
                  message={m}
                  onOpenSource={onOpenSource}
                  streamingText={streamingText}
                  isActive={m.status === 'drafting'}
                  onRetry={onRetryMessage}
                  onFollowup={onFollowup}
                  onOpenArtifact={onOpenArtifact}
                />
          )}
        </div>
      </div>
      {/* Jump-to-latest pill — appears when the user has scrolled up
          (autoScroll toggled off) AND there's either content to catch up to
          or an in-flight reply being composed. Clicking re-engages
          auto-scroll and drops the user at the bottom. */}
      {!autoScroll && session.messages.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            requestAnimationFrame(() => {
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            });
          }}
          className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-[12px] fg-base shadow-md anim-fade-in focus-ring"
          style={{
            bottom: 'calc(var(--composer-height, 108px) + 16px)',
            background: 'rgb(var(--hy-bg-surface))',
            border: '1px solid rgb(var(--hy-border-strong))',
          }}
          aria-label="Jump to latest messages"
        >
          <span aria-hidden="true">↓</span>
          Jump to latest
        </button>
      )}
      <div className="border-t-hy flex-shrink-0 bg-app">
        <div className="mx-auto w-full max-w-[780px] px-6 py-4">
          <Composer variant="panel" sessionId={session.id} onSend={onSend} onCancel={onCancel} onOpenPalette={onOpenPalette} onOpenMention={onOpenMention} busy={busy} pendingMention={pendingMention} onMentionConsumed={onMentionConsumed} pendingDraft={pendingDraft} onDraftConsumed={onDraftConsumed} />
        </div>
      </div>
    </div>
  );
}

