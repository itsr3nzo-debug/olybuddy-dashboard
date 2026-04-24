"use client";

/**
 * VaultView — document library for the client.
 *
 * Two modes:
 *  1. Project list (default) — grid of projects with file counts + actions.
 *  2. Project detail — file table, upload zone, delete, download.
 *
 * All state lives locally in this component; the owner can drill in and
 * back out without touching the chat's session state. File upload goes
 * direct-to-Supabase-Storage via the two-step /api/vault/upload +
 * /upload/complete flow — keeps bandwidth off Vercel's function tier and
 * scales to 100 MB files.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Download, FileText, Folder, FolderPlus, Plus, Search, Trash2,
  UploadCloud, X, Loader2, AlertCircle, CheckCircle2, Clock,
} from 'lucide-react';
import { cx } from '@/lib/chat/utils';
import { useClient } from '@/lib/chat/client-context';

// ── Types ──────────────────────────────────────────────────────────────
interface VaultProject {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  file_count: number;
}

interface VaultFile {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  tags: string[];
  page_count: number | null;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  uploaded_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────
const PRETTY_MIMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'image/png': 'Image',
  'image/jpeg': 'Image',
  'image/webp': 'Image',
};

function prettyMime(m: string | null): string {
  if (!m) return 'File';
  return PRETTY_MIMES[m] ?? m.split('/')[1]?.toUpperCase() ?? 'File';
}
function prettySize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function relative(iso: string): string {
  const d = new Date(iso).getTime();
  const age = Date.now() - d;
  if (age < 60_000) return 'just now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  const days = Math.floor(age / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB');
}

// ── Main component ─────────────────────────────────────────────────────

export function VaultView() {
  const [activeProject, setActiveProject] = useState<VaultProject | null>(null);

  return activeProject
    ? <ProjectDetail project={activeProject} onBack={() => setActiveProject(null)} />
    : <ProjectList onOpen={setActiveProject} />;
}

// ── Project list ───────────────────────────────────────────────────────

function ProjectList({ onOpen }: { onOpen: (p: VaultProject) => void }) {
  const { clientName } = useClient();
  const [projects, setProjects] = useState<VaultProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vault/projects', { cache: 'no-store' });
      if (!res.ok) throw new Error('load failed');
      const body = await res.json();
      setProjects(body.projects ?? []);
    } catch {
      setErr('Couldn\u2019t load projects. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(p =>
      p.name.toLowerCase().includes(needle)
      || (p.description ?? '').toLowerCase().includes(needle)
    );
  }, [projects, q]);

  const handleCreate = useCallback(async (name: string, description: string) => {
    try {
      const res = await fetch('/api/vault/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error('create failed');
      const body = await res.json();
      setProjects(prev => [body.project, ...prev]);
      setCreateOpen(false);
    } catch {
      setErr('Couldn\u2019t create project. Try again.');
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto px-8 pt-10 pb-12" style={{ maxWidth: 1100 }}>
        <div className="flex items-start justify-between gap-6 border-b-hy pb-5 mb-6">
          <div className="min-w-0">
            <h1 className="fg-base" style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1 }}>
              Vault
            </h1>
            <p className="text-[13px] fg-subtle mt-2 max-w-xl leading-relaxed">
              Upload documents Nexley can read — contracts, quotes, spec sheets, past jobs. Everything lives here, scoped to {clientName}, and the AI Employee cites sources when it uses them in chat.
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[12px] font-medium transition-opacity focus-ring hover:opacity-90 flex-shrink-0"
            style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
          >
            <FolderPlus size={13} />
            New project
          </button>
        </div>

        <div
          className="flex items-center gap-2 rounded-md px-3 h-9 mb-4"
          style={{ background: 'rgb(var(--hy-bg-subtle))', border: '1px solid rgb(var(--hy-border))' }}
        >
          <Search size={13} className="fg-muted flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 bg-transparent outline-none text-[12.5px] fg-base placeholder:fg-muted"
          />
        </div>

        {err && (
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 mb-3 text-[12px] fg-danger"
            style={{ background: 'rgb(var(--hy-danger) / 0.1)' }}
          >
            <AlertCircle size={13} />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 rounded-lg bg-hover animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={q ? 'No projects match your search' : 'No vault projects yet'}
            hint={q ? 'Try a different search term.' : 'Create a project for each client or matter. Upload relevant files and Nexley will reference them in conversations.'}
            cta={!q ? { label: 'Create your first project', onClick: () => setCreateOpen(true) } : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => onOpen(p)}
                className="text-left rounded-lg p-4 transition-colors hover:bg-hover focus-ring"
                style={{ border: '1px solid rgb(var(--hy-border))' }}
              >
                <div className="flex items-start gap-3">
                  <Folder size={16} className="fg-base mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] fg-base font-medium truncate">{p.name}</div>
                    {p.description && (
                      <p className="text-[12px] fg-subtle mt-1 line-clamp-2 leading-relaxed">{p.description}</p>
                    )}
                    <div className="text-[11px] fg-muted mt-2 flex items-center gap-2">
                      <span>{p.file_count} {p.file_count === 1 ? 'file' : 'files'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{relative(p.created_at)}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateProjectModal onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// ── Project detail ─────────────────────────────────────────────────────

function ProjectDetail({ project, onBack }: { project: VaultProject; onBack: () => void }) {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // uploading is a local map of transient uploads keyed by a UI-only id so
  // the file shows up in the table immediately with a progress bar, even
  // before the DB row confirms.
  const [uploading, setUploading] = useState<Array<{ id: string; filename: string; pct: number; err?: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vault/projects/${project.id}/files`, { cache: 'no-store' });
      if (!res.ok) throw new Error('load failed');
      const body = await res.json();
      setFiles(body.files ?? []);
    } catch {
      setErr('Couldn\u2019t load files. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Re-poll files every 3s while anything is in processing state — cheap
  // way to pick up ingest-complete status without a full realtime channel.
  useEffect(() => {
    if (!files.some(f => f.status === 'uploaded' || f.status === 'processing')) return;
    const t = setInterval(loadFiles, 3000);
    return () => clearInterval(t);
  }, [files, loadFiles]);

  const uploadOne = useCallback(async (file: File) => {
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setUploading(prev => [...prev, { id: uploadId, filename: file.name, pct: 0 }]);
    try {
      // Step 1: get signed upload URL + file_id
      const r1 = await fetch('/api/vault/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      });
      if (!r1.ok) {
        const body = await r1.json().catch(() => ({}));
        throw new Error(body.error || 'upload init failed');
      }
      const { file_id, upload_url } = await r1.json();

      // Step 2: PUT to signed URL with progress tracking via XHR.
      // fetch() doesn't expose upload progress; XHR still does, and this is
      // the only path worth the extra ceremony for UX.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 90); // leave headroom for step 3
          setUploading(prev => prev.map(u => u.id === uploadId ? { ...u, pct } : u));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`upload HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('upload network error'));
        xhr.send(file);
      });

      setUploading(prev => prev.map(u => u.id === uploadId ? { ...u, pct: 92 } : u));

      // Step 3: tell the server we're done so it can extract text.
      const r3 = await fetch('/api/vault/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id }),
      });
      if (!r3.ok) throw new Error('finalise failed');

      setUploading(prev => prev.filter(u => u.id !== uploadId));
      await loadFiles();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload failed';
      setUploading(prev => prev.map(u => u.id === uploadId ? { ...u, pct: 0, err: msg } : u));
    }
  }, [project.id, loadFiles]);

  const onFilesPicked = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    // Upload files in parallel but cap concurrency to 3 so we don't hammer
    // the serverless ingest endpoint.
    const queue = Array.from(fileList);
    const active: Promise<void>[] = [];
    while (queue.length > 0) {
      if (active.length >= 3) {
        await Promise.race(active);
      }
      const f = queue.shift()!;
      const p = uploadOne(f).finally(() => {
        const i = active.indexOf(p);
        if (i >= 0) active.splice(i, 1);
      });
      active.push(p);
    }
    await Promise.all(active);
  }, [uploadOne]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) onFilesPicked(e.dataTransfer.files);
  }, [onFilesPicked]);

  const deleteFile = useCallback(async (id: string) => {
    // Optimistic remove. If delete fails, reload from server.
    setFiles(prev => prev.filter(f => f.id !== id));
    try {
      const res = await fetch(`/api/vault/files/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
    } catch {
      setErr('Couldn\u2019t delete that file. Refreshing list.');
      loadFiles();
    }
  }, [loadFiles]);

  const downloadFile = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/vault/files/${id}/url`);
      if (!res.ok) throw new Error('url fetch failed');
      const body = await res.json();
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch {
      setErr('Couldn\u2019t open that file. Try again.');
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto px-8 pt-8 pb-12" style={{ maxWidth: 1100 }}>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[12px] fg-subtle hover:fg-base transition-colors mb-4"
        >
          <ArrowLeft size={13} />
          All projects
        </button>

        <div className="flex items-start justify-between gap-6 border-b-hy pb-5 mb-6">
          <div className="min-w-0">
            <h1 className="fg-base" style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1 }}>
              {project.name}
            </h1>
            {project.description && (
              <p className="text-[13px] fg-subtle mt-2 max-w-2xl leading-relaxed">{project.description}</p>
            )}
          </div>
        </div>

        {err && (
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 mb-3 text-[12px] fg-danger"
            style={{ background: 'rgb(var(--hy-danger) / 0.1)' }}
          >
            <AlertCircle size={13} />
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr(null)} aria-label="Dismiss" className="fg-muted hover:fg-base">
              <X size={12} />
            </button>
          </div>
        )}

        <div
          onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cx(
            'rounded-lg p-8 text-center cursor-pointer transition-colors',
            dragActive ? 'bg-hover' : 'hover:bg-hover',
          )}
          style={{ border: `1.5px dashed rgb(var(--hy-border))` }}
        >
          <UploadCloud size={22} className="fg-muted mx-auto mb-2" />
          <div className="text-[13px] fg-base font-medium mb-1">Drop files here or click to upload</div>
          <div className="text-[11.5px] fg-muted">PDF, Word, text, CSV or image. Up to 100 MB each.</div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              onFilesPicked(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {uploading.length > 0 && (
          <div className="mt-4 space-y-2">
            {uploading.map(u => (
              <div
                key={u.id}
                className="rounded-md px-3 py-2"
                style={{ border: '1px solid rgb(var(--hy-border))' }}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="text-[12px] fg-base truncate flex-1">{u.filename}</div>
                  <div className="text-[11px] fg-muted flex-shrink-0">
                    {u.err ? 'Failed' : u.pct >= 92 ? 'Finalising…' : `${u.pct}%`}
                  </div>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--hy-bg-subtle))' }}>
                  <div
                    className={u.err ? 'h-full bg-danger-subtle' : 'h-full'}
                    style={{
                      width: `${u.pct}%`,
                      background: u.err ? 'rgb(var(--hy-danger))' : 'rgb(var(--hy-fg-base))',
                      transition: 'width 0.25s ease',
                    }}
                  />
                </div>
                {u.err && <div className="text-[11px] fg-danger mt-1">{u.err}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <h4 className="text-[11px] uppercase tracking-wider fg-muted mb-3">Files</h4>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 rounded-md bg-hover animate-pulse" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="text-[12.5px] fg-subtle py-4">No files yet. Drop some in above — Nexley can cite them in chat once they&rsquo;re ready.</p>
          ) : (
            <div className="space-y-1">
              {files.map(f => (
                <FileRow key={f.id} file={f} onDelete={deleteFile} onDownload={downloadFile} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── File row ───────────────────────────────────────────────────────────

function FileRow({ file, onDelete, onDownload }: {
  file: VaultFile;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <div
      className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-hover transition-colors"
    >
      <FileText size={14} className="fg-muted flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] fg-base truncate">{file.filename}</div>
        <div className="text-[10.5px] fg-muted flex items-center gap-1.5 mt-0.5">
          <span>{prettyMime(file.mime_type)}</span>
          <span aria-hidden="true">·</span>
          <span>{prettySize(file.size_bytes)}</span>
          {file.page_count && (
            <>
              <span aria-hidden="true">·</span>
              <span>{file.page_count} pages</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{relative(file.uploaded_at)}</span>
        </div>
      </div>

      <StatusPill status={file.status} error={file.error_message} />

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onDownload(file.id)}
          aria-label="Download"
          className="h-7 w-7 flex items-center justify-center rounded hover:bg-hover fg-subtle hover:fg-base transition-colors"
          title="Download"
        >
          <Download size={13} />
        </button>
        <button
          onClick={() => { if (!armed) setArmed(true); else onDelete(file.id); }}
          aria-label={armed ? 'Click again to delete' : 'Delete'}
          className={cx(
            'h-7 px-2 flex items-center justify-center rounded transition-colors text-[11px]',
            armed ? 'fg-danger' : 'fg-subtle hover:fg-danger',
          )}
          style={armed ? { background: 'rgb(var(--hy-danger) / 0.1)' } : undefined}
          title={armed ? 'Click again to confirm' : 'Delete'}
        >
          {armed ? 'Delete?' : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status, error }: { status: VaultFile['status']; error: string | null }) {
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] fg-subtle px-1.5 py-0.5 rounded">
        <CheckCircle2 size={11} />
        Ready
      </span>
    );
  }
  if (status === 'processing' || status === 'uploaded') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] fg-muted px-1.5 py-0.5 rounded">
        <Loader2 size={11} className="animate-spin" />
        {status === 'uploaded' ? 'Queued' : 'Processing'}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] fg-danger px-1.5 py-0.5 rounded"
      title={error || 'File failed to process'}
    >
      <AlertCircle size={11} />
      Failed
    </span>
  );
}

// ── Empty state ────────────────────────────────────────────────────────

function EmptyState({ title, hint, cta }: {
  title: string;
  hint: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div
        className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'rgb(var(--hy-bg-subtle))' }}
      >
        <Folder size={20} />
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

// ── Create project modal ───────────────────────────────────────────────

function CreateProjectModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), description.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgb(0 0 0 / 0.4)' }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md rounded-lg bg-surface border-hy p-5 anim-fade-in"
        style={{ boxShadow: '0 20px 40px rgb(0 0 0 / 0.2)' }}
      >
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-[15px] fg-base font-medium">New project</h3>
          <button onClick={onClose} aria-label="Close" className="h-7 w-7 flex items-center justify-center rounded hover:bg-hover fg-subtle hover:fg-base">
            <X size={14} />
          </button>
        </div>
        <label className="block mb-3">
          <span className="text-[11.5px] fg-subtle block mb-1.5">Project name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sutton Manor refurb"
            className="w-full rounded-md px-3 h-9 text-[13px] bg-surface border-hy fg-base outline-none focus:border-[rgb(var(--hy-fg-base))]"
          />
        </label>
        <label className="block mb-5">
          <span className="text-[11.5px] fg-subtle block mb-1.5">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this project covers"
            rows={3}
            className="w-full rounded-md px-3 py-2 text-[13px] bg-surface border-hy fg-base outline-none resize-none focus:border-[rgb(var(--hy-fg-base))]"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 h-8 text-[12px] fg-subtle hover:fg-base hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[12px] font-medium transition-opacity focus-ring disabled:opacity-50"
            style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}

// also export Clock so the import at the top isn't tree-shaken if we add
// future time-based UI here.
void Clock;
