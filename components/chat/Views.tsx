"use client";

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, Folder, FileText, Users, Sparkles, Search,
  Zap, Activity, Check, Plus, Pin, MoreHorizontal, Share2, Download,
  AtSign, Command as CommandIcon, Sun, Moon,
} from 'lucide-react';
import { cx, relativeTime } from '@/lib/chat/utils';
import type { Session, Source, Suggestion, Workflow } from '@/lib/chat/types';
import { useClient } from '@/lib/chat/client-context';
import Composer, { UserBubble, AssistantBubble, SourceChipLarge } from './Composer';
import IconButton from './IconButton';
import {
  CitedProse, ThinkingTrace, ReceiptFooter,
  RedlineView, VersionTabs, ReviewTable,
  SelectionMenu, VoicePill, ProofStrip,
} from './Features';
import {
  PIPELINE_CITED, PIPELINE_VERSIONS,
  NUDGE_DIFF, NUDGE_VERSIONS,
  REVIEW_TABLE_PIPELINE,
  PIPELINE_RECEIPT, NUDGE_RECEIPT,
} from '@/lib/chat/mock';

/* ───────────── Browser chrome ───────────── */
function BrowserChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex flex-col">
      <div
        className="flex items-center gap-3 px-3 py-2 border-b-hy flex-shrink-0"
        style={{ background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <div className="flex items-center gap-1.5">
          <span style={{ width: 11, height: 11, borderRadius: 99, background: '#ed6a5e' }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: '#f5bf4f' }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: '#61c454' }} />
        </div>
        <div className="flex items-center gap-1 fg-muted">
          <ChevronLeft size={14} />
          <ChevronRight size={14} />
        </div>
        <div
          className="flex-1 mx-auto max-w-md flex items-center justify-center gap-2 rounded-md px-3 py-1 text-[11.5px] fg-subtle"
          style={{ background: 'rgb(var(--hy-bg-app))', border: '1px solid rgb(var(--hy-border))' }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgb(var(--hy-fg-muted))', opacity: 0.6 }} />
          app.nexley.ai
        </div>
        <div style={{ width: 40 }} />
      </div>
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
}

export function Dashboard({ onSend, onOpenPalette, onOpenMention, workflows }: DashboardProps) {
  // Source-selector state kept in case any decorative row is re-enabled; unused
  // right now because the rows below the composer are hidden until those
  // features ship. `void` prevents the linter from flagging.
  const [selected] = useState<Set<string>>(() => new Set(['crm', 'calls']));
  void selected;

  return (
    <BrowserChrome>
      <div className="h-full overflow-y-auto scroll-thin relative">
        <div className="absolute top-0 right-0 flex items-center gap-5 px-6 py-4 text-[11.5px] fg-muted z-10">
          <button className="inline-flex items-center gap-1 hover:fg-base transition-colors">
            <Sparkles size={12} />
            Tips
          </button>
        </div>

        <div className="mx-auto px-8 pt-32 pb-8 flex flex-col" style={{ maxWidth: 620 }}>
          <div className="text-center mb-14">
            <div
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 44,
                fontWeight: 400,
                letterSpacing: '-0.015em',
                lineHeight: 0.95,
              }}
              className="fg-base mb-3"
            >Nexley</div>
            <div className="flex justify-center">
              <ClientPin />
            </div>
          </div>

          <div className="flex items-center gap-6 text-[12px] fg-subtle mb-2.5 px-1">
            <button className="inline-flex items-center gap-1.5 hover:fg-base transition-colors">
              <Folder size={12} />
              Choose Vault project
            </button>
            <button className="inline-flex items-center gap-1.5 hover:fg-base transition-colors">
              <Users size={12} />
              Set client matter
            </button>
          </div>

          <Composer
            variant="hero"
            autoFocus
            onSend={onSend}
            onOpenPalette={onOpenPalette}
            onOpenMention={onOpenMention}
            busy={false}
          />

          {/* Decorative/demo rows hidden until the features behind them ship:
              VoicePill, SourceChipRow, ApplyBar, HeartbeatCard (fake stats).
              Leaves the composer + suggestions as the real empty-state. */}

          <div className="mt-6">
            <TipCarousel />
          </div>
        </div>

        <div className="mx-auto px-8 pt-8 pb-12" style={{ maxWidth: 1100 }}>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[11.5px] fg-muted">Recommended workflows</h3>
            <div className="flex items-center gap-4 text-[11.5px] fg-muted">
              <button className="inline-flex items-center gap-1 hover:fg-base transition-colors">
                <Search size={11} />
                Search
              </button>
              <button className="hover:fg-base transition-colors">View all</button>
            </div>
          </div>
          <div className="grid grid-cols-4" style={{ borderTop: '1px solid rgb(var(--hy-border))' }}>
            {workflows.slice(0, 4).map((w, i) => (
              <WorkflowCell key={i} w={w} i={i} last={i === 3} />
            ))}
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
  onOpenMention: () => void;
  onOpenPalette: () => void;
}

export function AssistPanel({ session, onSend, onOpenSource, streamingText, busy, onOpenMention, onOpenPalette }: AssistPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
  const lastMsg = session.messages[session.messages.length - 1];
  const showTrace = lastMsg?.role === 'assistant' && (lastMsg.status === 'thinking' || lastMsg.status === 'drafting');

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b-hy flex-shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] fg-base truncate" title={session.title}>{session.title}</div>
          <div className="text-[10.5px] fg-muted">
            {relativeTime(session.updatedAt ?? session.createdAt)}
            {' · '}
            {session.messages.length}
            {' messages'}
          </div>
        </div>
        <IconButton icon={Pin} label="Pin" size={12} />
        <IconButton icon={MoreHorizontal} label="More" size={13} />
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 py-4 space-y-4"
      >
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
        {showTrace && <ThinkingTrace startAt={new Date(lastMsg.createdAt).getTime()} />}
      </div>
      <div className="px-4 py-3 border-t-hy flex-shrink-0">
        <Composer variant="panel" onSend={onSend} onOpenPalette={onOpenPalette} onOpenMention={onOpenMention} busy={busy} />
      </div>
    </div>
  );
}

/* ───────────── ReplyCanvas ───────────── */
interface ReplyCanvasProps {
  session: Session;
  streamingText: string;
  onOpenSource: (src: Source) => void;
  onBackToDashboard: () => void;
}

export function ReplyCanvas({ session, streamingText, onOpenSource, onBackToDashboard }: ReplyCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [versionIdx, setVersionIdx] = useState(0);
  const [redlineMode, setRedlineMode] = useState('Redline');

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages, streamingText]);

  if (!session) return null;
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');

  const title = (session.title || '').toLowerCase();
  // Demo-only feature panels (cited paragraphs, redline diff, review table,
  // receipt strip) contain seeded Failsworth/Sarah Barker data. They only
  // render for the synthetic SEED_SESSIONS in `lib/chat/mock.ts`, which all
  // use IDs of the form `s1`, `s2`, etc. Real Supabase-backed sessions use
  // UUIDs and will NOT match this prefix, so these panels stay hidden.
  const isDemoSession = /^s\d+$/.test(session.id);
  const isPipeline = isDemoSession && title.includes('pipeline');
  const isNudge = isDemoSession && (title.includes('nudge') || title.includes('draft'));
  const isDone = lastAssistant?.status === 'done';

  const sources = lastAssistant?.sources || [];
  const cited = isPipeline ? (PIPELINE_VERSIONS[versionIdx]?.paragraphs || PIPELINE_CITED) : null;
  const receipt = isPipeline ? PIPELINE_RECEIPT : isNudge ? NUDGE_RECEIPT : null;

  const onPin = (sid: string, sourceId: string) => {
    setPinnedId(p => p === sid ? null : sid);
    const src = sources.find(s => s.id === sourceId);
    if (src) onOpenSource(src);
  };

  return (
    <div className="h-full flex flex-col min-h-0 bg-app">
      <div className="flex items-center gap-3 px-8 py-3 border-b-hy flex-shrink-0">
        <button
          onClick={onBackToDashboard}
          className="text-[11.5px] fg-muted hover:fg-base inline-flex items-center gap-1.5 transition-colors"
        >
          <ChevronLeft size={12} />
          Back
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <IconButton icon={Share2} label="Share" size={12} />
          <IconButton icon={Download} label="Export" size={12} />
          <IconButton icon={MoreHorizontal} label="More" size={13} />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin reply-scroll">
        <article ref={articleRef} className="mx-auto px-10 py-10 relative" style={{ maxWidth: 760 }}>
          {isDone && (
            <SelectionMenu
              containerRef={articleRef}
              onAction={(action, text) => {
                console.log('selection action', action, text);
              }}
            />
          )}

          {isDone && (
            <div className="mb-6">
              <ProofStrip
                model={isPipeline ? 'opus' : 'haiku'}
                calls={isPipeline ? 47 : 12}
                seconds={isPipeline ? 4.2 : 1.8}
                sources={sources.length}
                verified
                compact
              />
            </div>
          )}

          {isDone && isPipeline && (
            <VersionTabs versions={PIPELINE_VERSIONS} activeIdx={versionIdx} onSelect={setVersionIdx} />
          )}
          {isDone && isNudge && (
            <VersionTabs versions={NUDGE_VERSIONS} activeIdx={versionIdx} onSelect={setVersionIdx} />
          )}

          {lastUser && (
            <h1
              className="fg-base mb-8"
              style={{ fontFamily: 'var(--font-serif)', fontSize: 28, lineHeight: 1.2, fontWeight: 400, letterSpacing: '-0.01em' }}
            >{lastUser.content}</h1>
          )}

          {isDone && isPipeline && cited && (
            <div className="prose-hy">
              <CitedProse
                paragraphs={cited}
                sources={sources}
                pinnedId={pinnedId}
                onPin={onPin}
                firstParaClass="first-para"
              />
              <div style={{ fontFamily: 'var(--font-sans)' }}>
                <ReviewTable table={REVIEW_TABLE_PIPELINE} onOpenSource={onOpenSource} />
              </div>
            </div>
          )}

          {isDone && isNudge && (
            <RedlineView diff={NUDGE_DIFF} mode={redlineMode} onMode={setRedlineMode} />
          )}

          {(!isDone || (!isPipeline && !isNudge)) && (
            <div
              className="fg-base prose-hy"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {(lastAssistant?.content || streamingText || '').split('\n\n').map((p, i) => (
                <p key={i} className="mb-4">{p}</p>
              ))}
            </div>
          )}

          {isDone && sources.length > 0 && (
            <div className="mt-10 pt-6 border-t-hy" style={{ fontFamily: 'var(--font-sans)' }}>
              <div className="text-[11px] fg-muted mb-3 tracking-wider uppercase flex items-center justify-between">
                <span>Sources</span>
                <span className="normal-case tracking-normal text-[10.5px]">
                  Click any{' '}
                  <span className="cite-sup" style={{ verticalAlign: 0 }}>1</span>
                  {' to pin its source'}
                </span>
              </div>
              <div className="space-y-2">
                {sources.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="text-[10px] fg-muted font-mono flex-shrink-0"
                      style={{ width: 18, fontFamily: 'var(--font-mono)' }}
                    >{i + 1}</span>
                    <SourceChipLarge source={s} onOpen={onOpenSource} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDone && receipt && <ReceiptFooter receipt={receipt} />}
        </article>
      </div>
    </div>
  );
}
