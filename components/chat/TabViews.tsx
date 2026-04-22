"use client";

/**
 * TabViews — main-panel views for the non-Assistant sidebar tabs.
 *
 * Sidebar tabs: Assistant (owned by ChatApp), Vault, Workflows, History, Knowledge.
 * Each view is a self-contained panel. They reuse the existing chat typography
 * and design tokens (`fg-base`, `fg-subtle`, `border-b-hy`, etc.) so they
 * match the Assistant view.
 *
 * Empty states are deliberate — trial accounts start fresh. Strong
 * explanatory copy + clear next-action CTAs so a prospect watching a demo
 * understands what each tab is for.
 */

import React, { useState, useMemo } from 'react';
import {
  Folder, FolderPlus, Zap, Search, Plus, Book, Clock, FileText,
  BookOpen, Scroll, Bookmark, Sparkles, ChevronRight, Pin, Tag,
  FilePlus2,
} from 'lucide-react';
import { cx, relativeTime, groupSessionsByDate } from '@/lib/chat/utils';
import type { Session, Workflow } from '@/lib/chat/types';
import { useClient } from '@/lib/chat/client-context';

/* ────────────────────────────────────────────────────────────────
   Shared bits
   ──────────────────────────────────────────────────────────── */

function ViewHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-hy pb-5 mb-6">
      <div className="min-w-0">
        <h1
          className="fg-base"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 32,
            fontWeight: 400,
            letterSpacing: '-0.015em',
            lineHeight: 1,
          }}
        >
          {title}
        </h1>
        <p className="text-[13px] fg-subtle mt-2 max-w-xl leading-relaxed">{description}</p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

function EmptyState({
  icon: IconC,
  title,
  hint,
  cta,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  hint: string;
  cta?: { label: string; onClick?: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div
        className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <IconC size={20} />
      </div>
      <h3 className="text-[15px] fg-base font-medium mb-1.5">{title}</h3>
      <p className="text-[12.5px] fg-subtle max-w-sm leading-relaxed">{hint}</p>
      {cta && (
        <button
          onClick={cta.onClick}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[12px] font-medium transition-opacity focus-ring hover:opacity-90"
          style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
        >
          <Plus size={12} />
          {cta.label}
        </button>
      )}
    </div>
  );
}

function SearchRow({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 h-9 mb-4"
      style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
    >
      <Search size={13} className="fg-muted flex-shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-[12.5px] fg-base placeholder:fg-muted"
      />
    </div>
  );
}

function ViewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto px-8 pt-10 pb-12" style={{ maxWidth: 1100 }}>
        {children}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Vault
   ──────────────────────────────────────────────────────────── */

export function VaultView() {
  const { clientName } = useClient();
  const [q, setQ] = useState('');

  return (
    <ViewShell>
      <ViewHeader
        title="Vault"
        description={`Organise documents by matter. Upload contracts, correspondence, and files — Nexley reads across the whole project so you can ask questions spanning every document in ${clientName}'s book.`}
        action={
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[12px] font-medium transition-opacity focus-ring hover:opacity-90"
            style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
          >
            <FolderPlus size={13} />
            New project
          </button>
        }
      />

      <SearchRow placeholder="Search projects…" value={q} onChange={setQ} />

      <EmptyState
        icon={Folder}
        title="No vault projects yet"
        hint="Create a project for each matter or client. Drop in documents and Nexley can draft, review, and summarise across the whole corpus."
        cta={{ label: 'Create your first project' }}
      />

      <div className="mt-8 pt-6 border-t-hy">
        <h4 className="text-[11px] uppercase tracking-wider fg-muted mb-3">How teams use the Vault</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: Scroll, title: 'Matter files', hint: 'All documents for a single client or case in one place.' },
            { icon: Bookmark, title: 'Precedent library', hint: 'Reusable templates, standard clauses, and past drafts.' },
            { icon: FilePlus2, title: 'Discovery sets', hint: 'Large document sets Nexley can search and cite from.' },
          ].map(({ icon: IconC, title, hint }) => (
            <div
              key={title}
              className="rounded-lg p-4 transition-colors hover:bg-hover"
              style={{ border: '1px solid rgb(var(--hy-border))' }}
            >
              <IconC size={16} className="fg-base mb-2" />
              <div className="text-[13px] fg-base font-medium mb-1">{title}</div>
              <p className="text-[12px] fg-subtle leading-relaxed">{hint}</p>
            </div>
          ))}
        </div>
      </div>
    </ViewShell>
  );
}

/* ────────────────────────────────────────────────────────────────
   Workflows
   ──────────────────────────────────────────────────────────── */

interface WorkflowsViewProps {
  workflows: Workflow[];
  onStart: (prompt: string) => void;
}

export function WorkflowsView({ workflows, onStart }: WorkflowsViewProps) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('All');

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    workflows.forEach((w) => {
      if (w.kind) set.add(w.kind);
    });
    return Array.from(set);
  }, [workflows]);

  const filtered = useMemo(() => {
    return workflows.filter((w) => {
      if (category !== 'All' && w.kind !== category) return false;
      if (q && !(`${w.title} ${w.sub || ''}`.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [workflows, q, category]);

  return (
    <ViewShell>
      <ViewHeader
        title="Workflows"
        description="Pre-built prompt chains for the tasks you run most. Pick one to start — Nexley walks through the steps, cites sources, and produces a draft ready for your review."
      />

      <SearchRow placeholder="Search workflows…" value={q} onChange={setQ} />

      {categories.length > 1 && (
        <div className="flex items-center gap-1.5 mb-5 flex-wrap">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cx(
                'rounded-full px-3 py-1 text-[11.5px] transition-colors',
                category === c ? 'fg-base font-medium' : 'fg-subtle hover:fg-base'
              )}
              style={
                category === c
                  ? { background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }
                  : { border: '1px solid transparent' }
              }
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No workflows match"
          hint="Try a different search, or clear the filter to see every workflow."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((w, i) => (
            <button
              key={i}
              onClick={() => onStart(w.title)}
              className="text-left rounded-lg p-4 transition-colors hover:bg-hover focus-ring"
              style={{ border: '1px solid rgb(var(--hy-border))' }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <Zap size={14} className="fg-base flex-shrink-0 mt-0.5" />
                <ChevronRight size={13} className="fg-muted flex-shrink-0" />
              </div>
              <div className="text-[13.5px] fg-base font-medium mb-1 leading-snug">{w.title}</div>
              {w.sub && (
                <p className="text-[12px] fg-subtle leading-relaxed line-clamp-3">{w.sub}</p>
              )}
              <div className="mt-3 flex items-center gap-3 text-[10.5px] fg-muted">
                {w.kind && (
                  <span className="inline-flex items-center gap-1">
                    <Tag size={10} />
                    {w.kind}
                  </span>
                )}
                {typeof w.steps === 'number' && <span>{w.steps} steps</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </ViewShell>
  );
}

/* ────────────────────────────────────────────────────────────────
   History
   ──────────────────────────────────────────────────────────── */

interface HistoryViewProps {
  sessions: Session[];
  onSelectSession: (id: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
}

export function HistoryView({ sessions, onSelectSession, onPinSession }: HistoryViewProps) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q) return sessions;
    const needle = q.toLowerCase();
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(needle)) return true;
      const firstMsg = s.messages?.[0]?.content?.toLowerCase() ?? '';
      return firstMsg.includes(needle);
    });
  }, [sessions, q]);

  const groups = useMemo(() => groupSessionsByDate(filtered), [filtered]);

  return (
    <ViewShell>
      <ViewHeader
        title="History"
        description="Every conversation you've had with Nexley, grouped by date and fully searchable. Pin the ones you come back to."
      />

      <SearchRow placeholder="Search threads by title or content…" value={q} onChange={setQ} />

      {sessions.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No conversations yet"
          hint="Your threads will appear here as you chat with Nexley. Pinned threads stay at the top."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          hint={`Nothing found for "${q}". Try different words.`}
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([groupName, groupSessions]) => (
            <div key={groupName}>
              <div className="text-[11px] uppercase tracking-wider fg-muted mb-2 px-1">{groupName}</div>
              <div className="divide-y" style={{ borderColor: 'rgb(var(--hy-border))' }}>
                {groupSessions.map((s) => {
                  const firstAssistant = s.messages?.find((m) => m.role === 'assistant');
                  const firstUser = s.messages?.find((m) => m.role === 'user');
                  const preview = firstAssistant?.content || firstUser?.content || 'No messages yet.';
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSelectSession(s.id)}
                      className="w-full text-left py-3 px-1 flex items-start gap-3 hover:bg-hover transition-colors focus-ring rounded-md"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {s.pinned && <Pin size={11} className="fg-base flex-shrink-0" />}
                          <span className="text-[13px] fg-base font-medium truncate">{s.title}</span>
                        </div>
                        <p className="text-[12px] fg-subtle line-clamp-2 leading-relaxed">
                          {preview.replace(/\n+/g, ' ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 mt-0.5">
                        <span className="text-[11px] fg-muted whitespace-nowrap">{relativeTime(s.updatedAt)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPinSession(s.id, !s.pinned);
                          }}
                          className="p-1 rounded hover:bg-hover transition-colors"
                          aria-label={s.pinned ? 'Unpin' : 'Pin'}
                          title={s.pinned ? 'Unpin' : 'Pin'}
                        >
                          <Pin size={12} className={s.pinned ? 'fg-base' : 'fg-muted'} />
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </ViewShell>
  );
}

/* ────────────────────────────────────────────────────────────────
   Knowledge
   ──────────────────────────────────────────────────────────── */

export function KnowledgeView() {
  const [q, setQ] = useState('');

  const categories = [
    {
      icon: BookOpen,
      title: 'Playbooks',
      count: 0,
      hint: 'Step-by-step plans for the jobs your team runs regularly.',
    },
    {
      icon: FileText,
      title: 'Templates',
      count: 0,
      hint: 'Reusable drafts — letters, reports, case notes, checklists.',
    },
    {
      icon: Bookmark,
      title: 'Saved answers',
      count: 0,
      hint: 'Pin an answer once, Nexley reuses it next time.',
    },
    {
      icon: Scroll,
      title: 'Past memos',
      count: 0,
      hint: 'A searchable archive of every substantive reply Nexley has drafted.',
    },
    {
      icon: Sparkles,
      title: 'Imported guidance',
      count: 0,
      hint: 'External policy notes or internal SOPs you want Nexley to reference.',
    },
  ];

  const filtered = q
    ? categories.filter((c) => `${c.title} ${c.hint}`.toLowerCase().includes(q.toLowerCase()))
    : categories;

  return (
    <ViewShell>
      <ViewHeader
        title="Knowledge"
        description="Your organisation's memory. Everything Nexley should know — playbooks, templates, saved answers — gathered in one place and searchable from any chat."
        action={
          <button
            className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[12px] font-medium transition-opacity focus-ring hover:opacity-90"
            style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
          >
            <Plus size={13} />
            Add knowledge
          </button>
        }
      />

      <SearchRow placeholder="Search your knowledge…" value={q} onChange={setQ} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(({ icon: IconC, title, count, hint }) => (
          <button
            key={title}
            className="text-left rounded-lg p-4 transition-colors hover:bg-hover focus-ring"
            style={{ border: '1px solid rgb(var(--hy-border))' }}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgb(var(--hy-bg-subtle))' }}
              >
                <IconC size={14} />
              </div>
              <span className="text-[11px] fg-muted">{count} items</span>
            </div>
            <div className="text-[13.5px] fg-base font-medium mb-1">{title}</div>
            <p className="text-[12px] fg-subtle leading-relaxed">{hint}</p>
          </button>
        ))}
      </div>

      <div
        className="mt-6 rounded-lg p-5"
        style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
      >
        <div className="flex items-start gap-3">
          <Book size={16} className="fg-base flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] fg-base font-medium mb-1">Nexley learns from what you save</div>
            <p className="text-[12px] fg-subtle leading-relaxed">
              Approve a draft, pin an answer, or upload a playbook — Nexley uses it as
              context in every future chat. Your knowledge base compounds over time.
            </p>
          </div>
        </div>
      </div>
    </ViewShell>
  );
}
