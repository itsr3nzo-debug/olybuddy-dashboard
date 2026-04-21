"use client";

import React, { useState, useEffect } from 'react';
import {
  Activity, FileText, Table, Brain, ExternalLink, Check, Lock,
  MessageSquare, Search, RefreshCw, AlertCircle, Type, ChevronDown,
} from 'lucide-react';
import { cx } from '@/lib/chat/utils';
import type { Source } from '@/lib/chat/types';
import { useClient } from '@/lib/chat/client-context';

// Re-export Dashboard as the default export for ChatApp.
// Dashboard lives in Views.tsx to match the prototype; this re-export satisfies
// ChatApp's `import Dashboard from './Features'` expectation.
export { Dashboard as default } from './Views';

/* ───────────── Cited prose types ───────────── */
interface Sentence { text: string; cite?: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParaBlock = any;

interface CitedProseProps {
  paragraphs: ParaBlock[];
  sources: Source[];
  pinnedId: string | null;
  onPin?: (sid: string, sourceId: string) => void;
  onHover?: (sourceId: string | null) => void;
  firstParaClass?: string;
}

export function CitedProse({ paragraphs, sources, pinnedId, onPin, onHover, firstParaClass }: CitedProseProps) {
  return (
    <div className="cited-prose cited-margin" onMouseLeave={() => onHover?.(null)}>
      {paragraphs.map((p, pi) => {
        if (p.type === 'h2') return <h2 key={pi}>{p.text}</h2>;
        if (p.type === 'h3') return <h3 key={pi}>{p.text}</h3>;
        if (p.type === 'list') {
          return (
            <ul key={pi}>
              {p.items?.map((it: { sentences: Sentence[] }, ii: number) => (
                <li key={ii}>{renderSentences(it.sentences, sources, pinnedId, onPin, onHover, `${pi}-${ii}`)}</li>
              ))}
            </ul>
          );
        }
        const isFirst = pi === paragraphs.findIndex(x => !x.type || x.type === 'p');
        return (
          <p key={pi} className={isFirst && firstParaClass ? firstParaClass : undefined}>
            {renderSentences(p.sentences || [], sources, pinnedId, onPin, onHover, String(pi))}
          </p>
        );
      })}
    </div>
  );
}

function renderSentences(
  sentences: Sentence[],
  sources: Source[],
  pinnedId: string | null,
  onPin: ((sid: string, sourceId: string) => void) | undefined,
  onHover: ((sourceId: string | null) => void) | undefined,
  rowKey: string,
) {
  return sentences.map((s, si) => {
    if (!s.cite) {
      return <React.Fragment key={si}>{s.text}{' '}</React.Fragment>;
    }
    const srcIdx = sources.findIndex(x => x.id === s.cite);
    const n: string | number = srcIdx >= 0 ? srcIdx + 1 : '?';
    const sid = `${rowKey}-${s.cite}-${si}`;
    const pinned = pinnedId === sid;
    return (
      <span
        key={si}
        className={cx('cited-row', pinned && 'is-pinned')}
        onMouseEnter={() => onHover?.(s.cite!)}
        onClick={(e) => { e.stopPropagation(); onPin?.(sid, s.cite!); }}
        style={{ position: 'relative', cursor: 'pointer' }}
      >
        <span className={cx('margin-dot', pinned && 'is-active')} aria-label={`Source ${n}`}>
          <span className="md-pip" />
          <span className="md-num">{n}</span>
        </span>
        {s.text}
        {' '}
      </span>
    );
  });
}

/* ───────────── Proof strip ───────────── */
interface ProofStripProps {
  model?: string;
  calls?: number;
  seconds?: number;
  sources?: number;
  verified?: boolean;
  compact?: boolean;
}

export function ProofStrip({ calls = 47, seconds = 4.2, sources = 4, verified = true, compact = false }: ProofStripProps) {
  if (compact) {
    return (
      <div className="proof-strip" title="Nexley AI response">
        <span className="proof-dot" />
        <span>Nexley AI</span>
        <span className="proof-sep" />
        <span>{`${seconds.toFixed(1)}s`}</span>
        <span className="proof-sep" />
        <span>{`${sources} src`}</span>
        {verified && (
          <>
            <span className="proof-sep" />
            <span style={{ color: 'rgb(var(--hy-success))' }}>ok</span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="proof-strip" title="Nexley AI response">
      <span className="proof-dot" />
      <span>Nexley AI</span>
      <span className="proof-sep" />
      <span>{`${calls} steps`}</span>
      <span className="proof-sep" />
      <span>{`${seconds.toFixed(1)}s`}</span>
      <span className="proof-sep" />
      <span>{`${sources} sources`}</span>
      {verified && (
        <>
          <span className="proof-sep" />
          <span style={{ color: 'rgb(var(--hy-success))' }}>verified</span>
        </>
      )}
    </div>
  );
}

/* ───────────── Inline bar ───────────── */
export function InlineBar({ value, max, width = 32 }: { value: number; max: number; width?: number; tone?: string }) {
  const pct = Math.min(100, Math.max(2, (value / max) * 100));
  return (
    <span className="bar-mark" style={{ width }} aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/* ───────────── Thinking trace ───────────── */
const TRACE_STEPS = [
  { t: 0, ms: 420, label: 'Parsing intent', stage: 'Understand', detail: '8 tokens · 1 step' },
  { t: 420, ms: 620, label: 'Searching CRM', stage: 'Retrieve', detail: '3,241 contacts · vector k=24' },
  { t: 1040, ms: 540, label: 'Cross-referencing call log', stage: 'Retrieve', detail: 'Last 90d · 142 calls' },
  { t: 1580, ms: 480, label: 'Scoring priority', stage: 'Reason', detail: 'Pipeline-weighted' },
  { t: 2060, ms: 900, label: 'Drafting reply', stage: 'Draft', detail: 'Business-style tone' },
  { t: 2960, ms: 320, label: 'Verifying citations', stage: 'Verify', detail: '4 sources matched' },
];

export function ThinkingTrace({ startAt }: { startAt?: number }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t0 = startAt || Date.now();
    const id = setInterval(() => setNow(Date.now() - t0), 80);
    return () => clearInterval(id);
  }, [startAt]);

  return (
    <div className="rounded-md border-hy bg-surface overflow-hidden" style={{ padding: '10px 14px' }}>
      <div className="flex items-center justify-between mb-2 text-[10.5px] fg-muted uppercase tracking-wider">
        <span className="inline-flex items-center gap-1.5">
          <Activity size={10} />
          Thinking
        </span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>{(now / 1000).toFixed(1) + 's'}</span>
      </div>
      <div className="space-y-[1px]">
        {TRACE_STEPS.map((step, i) => {
          const started = now >= step.t;
          const done = now >= step.t + step.ms;
          const active = started && !done;
          return (
            <div
              key={i}
              className={cx('trace-row', active && 'is-active', done && 'is-done')}
              style={{ opacity: started ? 1 : 0.28, transition: 'opacity 0.2s' }}
            >
              <span className="trace-tick">{done ? '✓' : active ? '›' : '·'}</span>
              <span className="trace-model">{step.stage}</span>
              <span>
                {step.label}
                <span className="fg-muted" style={{ marginLeft: 8 }}>{step.detail}</span>
              </span>
              <span className="trace-tick">{done ? `${step.ms}ms` : active ? '…' : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── Receipt footer ───────────── */
interface Receipt {
  savedHours: string | number;
  sourcesCited: string | number;
  verified: string | number;
  verifiedSub?: string;
  modelCalls: string | number;
  modelSub?: string;
}

export function ReceiptFooter({ receipt }: { receipt: Receipt | null }) {
  if (!receipt) return null;
  const items = [
    { value: receipt.savedHours, label: 'Time saved', sub: 'vs manual lookup' },
    { value: receipt.sourcesCited, label: 'Sources cited', sub: 'all verifiable' },
    { value: receipt.verified, label: 'Verified', sub: receipt.verifiedSub || 'by you' },
    { value: receipt.modelCalls, label: 'Model calls', sub: receipt.modelSub || 'routed' },
  ];
  return (
    <div className="mt-10" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="text-[10.5px] fg-muted mb-2 tracking-wider uppercase">Receipt</div>
      <div className="receipt-card">
        {items.map((it, i) => (
          <div key={i} className="receipt-cell">
            <div className="receipt-value">{it.value}</div>
            <div className="receipt-label">{it.label}</div>
            <div className="text-[10.5px] fg-subtle mt-0.5">{it.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Redline view ───────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiffChunk = any;

export function RedlineView({ diff, mode, onMode }: { diff: DiffChunk[]; mode: string; onMode: (m: string) => void }) {
  return (
    <div className="rounded-md border-hy bg-surface overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b-hy"
        style={{ background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <div className="text-[11px] fg-muted uppercase tracking-wider inline-flex items-center gap-1.5">
          <FileText size={11} />
          Draft revision
        </div>
        <div className="flex items-center gap-1">
          {['Clean', 'Redline'].map(m => (
            <button
              key={m}
              onClick={() => onMode(m)}
              className={cx('vtab', mode === m && 'is-active')}
            >{m}</button>
          ))}
        </div>
      </div>
      <div
        className="px-5 py-4 text-[13.5px] fg-base"
        style={{ fontFamily: 'var(--font-serif)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}
      >
        {diff.map((chunk, i) => {
          if (mode === 'Clean') {
            if (chunk.op === 'del') return null;
            return <span key={i}>{chunk.text}</span>;
          }
          if (chunk.op === 'ins') return <span key={i} className="redline-ins">{chunk.text}</span>;
          if (chunk.op === 'del') return <span key={i} className="redline-del">{chunk.text}</span>;
          return <span key={i}>{chunk.text}</span>;
        })}
      </div>
    </div>
  );
}

/* ───────────── Version tabs ───────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Version = any;

export function VersionTabs({ versions, activeIdx, onSelect }: { versions: Version[]; activeIdx: number; onSelect: (i: number) => void }) {
  if (!versions || versions.length < 2) return null;
  return (
    <div className="flex items-center gap-1 mb-3" style={{ fontFamily: 'var(--font-sans)' }}>
      <span className="text-[10.5px] fg-muted uppercase tracking-wider mr-2">Versions</span>
      {versions.map((v, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={cx('vtab', i === activeIdx && 'is-active')}
          title={v.label}
        >
          {`v${i + 1}`}
          <span className="fg-muted ml-1.5" style={{ fontSize: 10 }}>{v.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────── Review table ───────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReviewTableData = any;

export function ReviewTable({ table, onOpenSource }: { table: ReviewTableData; onOpenSource?: (s: Source) => void }) {
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const [verified, setVerified] = useState<Set<string>>(() => new Set(table.verifiedDefault || []));

  const key = (r: number, c: number) => `${r}:${c}`;
  const isVerified = (r: number, c: number) => verified.has(key(r, c));
  const toggleVerify = (r: number, c: number) => setVerified(s => {
    const n = new Set(s);
    const k = key(r, c);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const activeCell = selected
    ? table.rows[selected.row]?.cells[selected.col]
    : null;

  return (
    <div className="rounded-md border-hy bg-surface overflow-hidden my-4" style={{ fontFamily: 'var(--font-sans)' }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b-hy"
        style={{ background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <div className="text-[11px] fg-muted uppercase tracking-wider inline-flex items-center gap-1.5">
          <Table size={11} />
          {table.title || 'Review table'}
        </div>
        <div className="text-[11px] fg-muted">
          {`${verified.size}/${table.rows.length * table.columns.length} verified`}
        </div>
      </div>
      <div className="flex">
        <div className="flex-1 min-w-0 overflow-x-auto scroll-thin">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  className="text-left px-3 py-2 text-[10.5px] uppercase tracking-wider fg-muted font-semibold"
                  style={{ borderBottom: '1px solid rgb(var(--hy-border))', width: 130 }}
                >{table.rowHeader || ''}</th>
                {table.columns.map((c: string, ci: number) => (
                  <th
                    key={ci}
                    className="text-left px-3 py-2 text-[10.5px] uppercase tracking-wider fg-muted font-semibold"
                    style={{ borderBottom: '1px solid rgb(var(--hy-border))' }}
                  >{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row: { label: string; cells: Array<{ value: React.ReactNode; bar?: number; barMax?: number; reasoning?: string; source?: Source | null }> }, ri: number) => (
                <tr key={ri}>
                  <td
                    className="px-3 py-2 text-[12.5px] fg-base font-medium"
                    style={{ borderBottom: '1px solid rgb(var(--hy-border))' }}
                  >{row.label}</td>
                  {row.cells.map((cell, ci: number) => (
                    <td
                      key={ci}
                      onClick={() => setSelected({ row: ri, col: ci })}
                      className={cx(
                        'rt-cell',
                        isVerified(ri, ci) && 'is-verified',
                        selected?.row === ri && selected?.col === ci && 'is-selected',
                      )}
                    >
                      <span className="rt-check">
                        <Check size={10} strokeWidth={3} />
                      </span>
                      {cell.bar != null && (
                        <InlineBar value={cell.bar} max={cell.barMax || 1} width={28} />
                      )}
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {activeCell && selected && (
          <div className="border-l-hy flex-shrink-0" style={{ width: 260, background: 'rgb(var(--hy-bg-subtle) / 0.4)' }}>
            <div className="p-3">
              <div className="text-[10.5px] fg-muted uppercase tracking-wider mb-1.5 inline-flex items-center gap-1">
                <Brain size={10} />
                Model reasoning
              </div>
              <div className="text-[12px] fg-base mb-2 font-medium">{activeCell.value}</div>
              <p
                className="text-[11.5px] fg-subtle leading-relaxed mb-2.5"
                style={{ fontFamily: 'var(--font-serif)' }}
              >{activeCell.reasoning || 'No reasoning recorded.'}</p>
              {activeCell.source && (
                <button
                  onClick={() => activeCell.source && onOpenSource?.(activeCell.source)}
                  className="inline-flex items-center gap-1.5 text-[11px] fg-subtle hover:fg-base transition-colors"
                >
                  <ExternalLink size={10} />
                  Open source
                </button>
              )}
              <div className="mt-3 pt-3 border-t-hy">
                <button
                  onClick={() => toggleVerify(selected.row, selected.col)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors',
                    isVerified(selected.row, selected.col)
                      ? 'fg-success'
                      : 'fg-subtle hover:fg-base bg-subtle',
                  )}
                  style={isVerified(selected.row, selected.col)
                    ? { background: 'rgb(var(--hy-success) / 0.12)' }
                    : undefined}
                >
                  {(() => {
                    const VIcon = isVerified(selected.row, selected.col) ? Lock : Check;
                    return <VIcon size={10} />;
                  })()}
                  {isVerified(selected.row, selected.col) ? 'Verified · locked' : 'Mark verified'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── Selection menu ───────────── */
interface SelectionMenuProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onAction?: (key: string, text: string) => void;
}

export function SelectionMenu({ containerRef, onAction }: SelectionMenuProps) {
  const [state, setState] = useState<{ top: number; left: number; text: string } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timeout: ReturnType<typeof setTimeout>;

    const compute = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setState(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 3) { setState(null); return; }
      const rect = range.getBoundingClientRect();
      const cont = container.getBoundingClientRect();
      setState({
        top: rect.top - cont.top - 40,
        left: rect.left - cont.left + rect.width / 2,
        text,
      });
    };

    const onChange = () => {
      clearTimeout(timeout);
      timeout = setTimeout(compute, 250);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      clearTimeout(timeout);
    };
  }, [containerRef]);

  if (!state) return null;

  const actions = [
    { icon: MessageSquare, label: 'Explain', key: 'explain' },
    { icon: Search, label: 'Cite', key: 'cite' },
    { icon: RefreshCw, label: 'Rewrite', key: 'rewrite' },
    { icon: AlertCircle, label: 'Flag', key: 'flag' },
  ];

  return (
    <div
      className="selection-menu anim-fade-in"
      style={{ top: state.top, left: state.left, transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {actions.map((a, i) => {
        const IconC = a.icon;
        return (
          <React.Fragment key={a.key}>
            {i > 0 && <span className="sep" />}
            <button onClick={() => onAction?.(a.key, state.text)}>
              <IconC size={11} />
              {a.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ───────────── Voice pill ───────────── */
export function VoicePill() {
  const [open, setOpen] = useState(false);
  const { clientName } = useClient();
  const houseStyle = `${clientName} house style`;
  const [voice, setVoice] = useState(houseStyle);
  // keep local label in sync when clientName resolves after mount
  useEffect(() => { setVoice(houseStyle); }, [houseStyle]);
  const options = [
    { name: houseStyle, sub: "Matches your business's tone. Learned from past messages." },
    { name: 'Formal client', sub: 'Business-formal. Hedged. Legal-safe.' },
    { name: 'Quick & casual', sub: 'Short, plain, first-name.' },
  ];

  return (
    <div className="relative" style={{ display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 h-[26px] text-[11px] fg-subtle hover:fg-base transition-colors"
        style={{ border: '1px solid rgb(var(--hy-border))', background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <Type size={10} />
        <span className="fg-muted">Voice:</span>
        {voice}
        <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 20 }}
            onClick={() => setOpen(false)}
          />
          <div className="voice-pop anim-fade-in">
            <div className="text-[10.5px] fg-muted uppercase tracking-wider mb-2">Writing voice</div>
            {options.map((o) => (
              <button
                key={o.name}
                onClick={() => { setVoice(o.name); setOpen(false); }}
                className={cx(
                  'w-full text-left px-2 py-1.5 rounded hover:bg-hover transition-colors mb-0.5 flex items-start gap-2',
                  o.name === voice && 'bg-subtle',
                )}
              >
                <span
                  className="mt-0.5"
                  style={{
                    width: 10, height: 10, borderRadius: 99,
                    border: '1.5px solid rgb(var(--hy-border-strong))',
                    background: o.name === voice ? 'rgb(var(--hy-fg-base))' : 'transparent',
                    flexShrink: 0,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <div className="text-[12px] fg-base">{o.name}</div>
                  <div className="text-[10.5px] fg-muted leading-snug mt-0.5">{o.sub}</div>
                </span>
              </button>
            ))}
            <div className="mt-2 pt-2 border-t-hy text-[10.5px] fg-muted flex items-center justify-between">
              <span>Learned from your past writing</span>
              <button className="fg-subtle hover:fg-base">Manage</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
