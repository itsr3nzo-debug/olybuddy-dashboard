"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, Folder, PencilLine, Plus, Search, Settings, Sun, Moon,
  MoreHorizontal, ChevronDown, Pin, Trash2, Pencil, Download, History,
  Book, PanelLeft, HelpCircle, LogOut, Zap, Users,
} from 'lucide-react';
import { cx, relativeTime, groupSessionsByDate } from '@/lib/chat/utils';
import type { Session } from '@/lib/chat/types';
import { useClient } from '@/lib/chat/client-context';
import { createClient } from '@/lib/supabase/client';
import IconButton from './IconButton';

export type ChatView = 'assistant' | 'customers' | 'vault' | 'workflows' | 'history' | 'knowledge';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onOpenPalette: () => void;
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
  collapsed: boolean;
  onToggleCollapse: () => void;
  onGoHome: () => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  activeView: ChatView;
  onNavChange: (view: ChatView) => void;
}

function Sidebar({ sessions, currentSessionId, onSelectSession, onNewChat, onOpenPalette, onToggleTheme, theme, collapsed, onToggleCollapse, onGoHome, onRenameSession, onDeleteSession, onPinSession, activeView, onNavChange }: SidebarProps) {
  const { clientName } = useClient();
  const groups = groupSessionsByDate(sessions);
  const clientInitials = (clientName || 'N')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'N';

  return (
    <aside
      // Width rules:
      //  - Desktop (lg+): fixed 200px expanded / 52px collapsed (legacy behaviour).
      //  - Mobile (< lg): expanded = full-width so the WhatsApp-style list view
      //    fills the screen (ChatApp already hides main on mobile when on the
      //    list); collapsed = 52px so the compact rail is still reachable.
      className={cx(
        'sidebar-col flex flex-col border-r-hy bg-app flex-shrink-0',
        collapsed
          ? 'w-[52px] min-w-[52px] sidebar-collapsed'
          : 'w-full lg:w-[200px] lg:min-w-[200px]'
      )}
      style={{ transition: 'width 0.18s ease' }}
    >
      {collapsed
        ? <SidebarRail onNewChat={onNewChat} onOpenPalette={onOpenPalette} onToggleTheme={onToggleTheme} theme={theme} onToggleCollapse={onToggleCollapse} onGoHome={onGoHome} activeView={activeView} onNavChange={onNavChange} />
        : <SidebarFull clientInitials={clientInitials} sessions={sessions} groups={groups} currentSessionId={currentSessionId} onSelectSession={onSelectSession} onNewChat={onNewChat} onOpenPalette={onOpenPalette} onToggleTheme={onToggleTheme} theme={theme} onToggleCollapse={onToggleCollapse} onGoHome={onGoHome} onRenameSession={onRenameSession} onDeleteSession={onDeleteSession} onPinSession={onPinSession} activeView={activeView} onNavChange={onNavChange} />
      }
    </aside>
  );
}

interface SidebarRailProps {
  onNewChat: () => void;
  onOpenPalette: () => void;
  onToggleTheme: () => void;
  theme: 'light' | 'dark';
  onToggleCollapse: () => void;
  onGoHome: () => void;
  activeView: ChatView;
  onNavChange: (view: ChatView) => void;
}

function SidebarRail({ onNewChat, onOpenPalette, onToggleTheme, theme, onToggleCollapse, onGoHome, activeView, onNavChange }: SidebarRailProps) {
  const { clientName } = useClient();
  const initials = (clientName || 'N')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'N';
  return (
    <div className="flex flex-col items-center py-3 gap-1.5 h-full">
      <button
        onClick={onGoHome}
        className="h-7 w-7 rounded flex items-center justify-center text-[10px] font-semibold focus-ring"
        style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
      >{initials}</button>
      <div className="h-px w-6 my-2" style={{ background: 'rgb(var(--hy-border))' }} />
      <IconButton icon={Plus} label="Create" onClick={onNewChat} size={14} />
      <IconButton icon={Search} label="Search (⌘K)" onClick={onOpenPalette} size={14} />
      <div className="h-px w-6 my-1" style={{ background: 'rgb(var(--hy-border))' }} />
      <IconButton icon={MessageSquare} label="Assistant" size={14} active={activeView === 'assistant'} onClick={() => onNavChange('assistant')} />
      <IconButton icon={Users} label="Customers" size={14} active={activeView === 'customers'} onClick={() => onNavChange('customers')} />
      <IconButton icon={Folder} label="Vault" size={14} active={activeView === 'vault'} onClick={() => onNavChange('vault')} />
      <IconButton icon={Zap} label="Workflows" size={14} active={activeView === 'workflows'} onClick={() => onNavChange('workflows')} />
      <IconButton icon={History} label="History" size={14} active={activeView === 'history'} onClick={() => onNavChange('history')} />
      <IconButton icon={Book} label="Knowledge" size={14} active={activeView === 'knowledge'} onClick={() => onNavChange('knowledge')} />
      <div className="flex-1" />
      <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Light' : 'Dark'} onClick={onToggleTheme} size={14} />
      <IconButton icon={PanelLeft} label="Expand" onClick={onToggleCollapse} size={14} />
    </div>
  );
}

interface SidebarFullProps extends SidebarRailProps {
  clientInitials: string;
  sessions: Session[];
  groups: Array<[string, Session[]]>;
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
}

function SidebarFull({ clientInitials, groups, currentSessionId, onSelectSession, onNewChat, onOpenPalette, onToggleTheme, theme, onToggleCollapse, onGoHome, onRenameSession, onDeleteSession, onPinSession, activeView, onNavChange }: SidebarFullProps) {
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const { clientName } = useClient();
  return (
    <>
      <div className="px-2.5 pt-3 pb-2 flex items-center justify-between gap-1">
        <button
          onClick={onGoHome}
          className="flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded-md hover:bg-hover transition-colors focus-ring text-left"
        >
          <div
            className="h-[18px] w-[18px] rounded-sm flex items-center justify-center text-[9px] font-semibold flex-shrink-0"
            style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))', letterSpacing: '-0.01em' }}
          >{clientInitials}</div>
          <span className="text-[12px] fg-base truncate max-w-[110px]">{clientName}</span>
          <ChevronDown size={11} className="fg-muted flex-shrink-0" />
        </button>
        <div className="flex items-center">
          <IconButton icon={Search} label="Search (⌘K)" onClick={onOpenPalette} size={12} className="h-6 w-6" />
          <IconButton icon={PanelLeft} label="Collapse" onClick={onToggleCollapse} size={12} className="h-6 w-6" />
        </div>
      </div>

      <div className="px-2.5 pb-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1 rounded-md px-3 h-7 text-[12px] font-medium transition-opacity focus-ring"
          style={{ background: 'rgb(var(--hy-fg-base))', color: 'rgb(var(--hy-fg-inverse))' }}
        >
          <Plus size={12} />
          Create
        </button>
      </div>

      <nav className="px-1.5 space-y-0.5">
        <NavItem icon={MessageSquare} label="Assistant" active={activeView === 'assistant'} onClick={() => onNavChange('assistant')} />
        <NavItem icon={Users} label="Customers" active={activeView === 'customers'} onClick={() => onNavChange('customers')} />
        <NavItem icon={Folder} label="Vault" active={activeView === 'vault'} onClick={() => onNavChange('vault')} />
        <NavItem icon={Zap} label="Workflows" active={activeView === 'workflows'} onClick={() => onNavChange('workflows')} />
        <NavItem icon={History} label="History" active={activeView === 'history'} onClick={() => onNavChange('history')} />
        <NavItem icon={Book} label="Knowledge" active={activeView === 'knowledge'} onClick={() => onNavChange('knowledge')} />
      </nav>

      <div className="flex-1 overflow-y-auto scroll-thin mt-7 px-1.5 pb-4">
        {groups.map(([groupName, groupSessions]) => {
          const limit = showAll[groupName] ? groupSessions.length : Math.min(groupSessions.length, 5);
          return (
            <div key={groupName} className="mb-3">
              <div className="text-[10px] fg-muted px-2 mb-1 uppercase tracking-wider">{groupName}</div>
              <div className="space-y-px">
                {groupSessions.slice(0, limit).map(s => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    active={s.id === currentSessionId}
                    onSelect={() => onSelectSession(s.id)}
                    onRename={(title) => onRenameSession(s.id, title)}
                    onDelete={() => onDeleteSession(s.id)}
                    onPin={(pinned) => onPinSession(s.id, pinned)}
                  />
                ))}
              </div>
              {groupSessions.length > 5 && !showAll[groupName] && (
                <button
                  onClick={() => setShowAll({ ...showAll, [groupName]: true })}
                  className="text-[10.5px] fg-muted hover:fg-base px-2 py-0.5 transition-colors"
                >{`Show all (${groupSessions.length})`}</button>
              )}
            </div>
          );
        })}
      </div>

      <SidebarBottom onToggleTheme={onToggleTheme} theme={theme} />
    </>
  );
}

function SidebarBottom({ onToggleTheme, theme }: { onToggleTheme: () => void; theme: 'light' | 'dark' }) {
  const { userEmail, ownerName } = useClient();
  const userInitials = (() => {
    const src = ownerName || userEmail.split('@')[0] || '';
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    const ini = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
    return ini || 'U';
  })();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const id = setTimeout(() => window.addEventListener('click', close, { once: true }));
    return () => { clearTimeout(id); window.removeEventListener('click', close); };
  }, [open]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/auth/login';
  };

  const menuItems: Array<{ icon: React.ComponentType<{ size?: number }>; label: string; onClick?: () => void }> = [
    { icon: theme === 'dark' ? Sun : Moon, label: theme === 'dark' ? 'Light mode' : 'Dark mode', onClick: onToggleTheme },
    { icon: Settings, label: 'Settings', onClick: () => { window.location.href = '/settings'; } },
    { icon: LogOut, label: 'Sign out', onClick: handleSignOut },
  ];

  return (
    <div className="px-3 py-2 flex items-center justify-between relative">
      {/* Help was previously a decorative button with no onClick — now opens
          a plain <a> to the Nexley docs so clicking actually does something.
          target="_blank" keeps the dashboard open. */}
      <a
        href="https://nexley.ai/docs"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[11.5px] fg-muted hover:fg-base transition-colors px-1 py-0.5 rounded focus-ring"
        title="Opens the Nexley docs in a new tab"
      >
        <HelpCircle size={12} />
        Help
      </a>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-semibold focus-ring"
        style={{ background: 'rgb(var(--hy-bg-hover))', color: 'rgb(var(--hy-fg-base))' }}
        aria-label="Account"
      >{userInitials}</button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-full right-2 mb-1 w-44 rounded-md bg-surface border-hy anim-fade-in z-30 py-1"
          style={{ boxShadow: '0 10px 24px rgb(0 0 0 / 0.12)' }}
        >
          <div className="px-3 py-2 border-b-hy">
            <UserMenuHeader />
          </div>
          {menuItems.map((it, i) => {
            const IconC = it.icon;
            return (
              <button
                key={i}
                onClick={() => { it.onClick?.(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] fg-subtle hover:bg-hover hover:fg-base transition-colors"
              >
                <IconC size={12} />
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface NavItemProps {
  icon: React.ComponentType<{ size?: number }>;
  iconActive?: React.ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function UserMenuHeader() {
  const { clientName, userEmail, ownerName } = useClient();
  const displayName = ownerName || (userEmail.split('@')[0] || 'Owner');
  return (
    <>
      <div className="text-[12px] fg-base font-medium truncate">{displayName}</div>
      <div className="text-[11px] fg-muted truncate">Admin · {clientName}</div>
    </>
  );
}

function NavItem({ icon: IconC, iconActive, label, active, onClick }: NavItemProps) {
  const IconToUse = active && iconActive ? iconActive : IconC;
  return (
    <button
      onClick={onClick}
      className={cx(
        'w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors focus-ring',
        active ? 'fg-base font-medium' : 'fg-subtle hover:fg-base'
      )}
      style={active ? { background: 'rgb(var(--hy-bg-subtle) / 0.6)' } : undefined}
    >
      <IconToUse size={14} />
      {label}
    </button>
  );
}

function SessionItem({ session, active, onSelect, onRename, onDelete, onPin }: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onPin: (pinned: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverTimer, setHoverTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [renameEditing, setRenameEditing] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  // Two-step delete confirm: first click arms, second click commits. Auto-
  // disarms after 4s so a stray click doesn't leave a loaded gun in the menu.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(t);
  }, [deleteArmed]);
  useEffect(() => {
    if (!menuOpen) setDeleteArmed(false);
  }, [menuOpen]);

  // Close the action menu on any outside click — onMouseLeave alone is
  // unreliable if the user switches tabs or scrolls without the mouse
  // physically leaving the session item. Without this the menu "floats"
  // over the next view.
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!menuRootRef.current) return;
      if (menuRootRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    // setTimeout so this handler doesn't catch the same click that opened the menu
    const id = setTimeout(() => {
      window.addEventListener('click', onClickOutside);
      window.addEventListener('keydown', onEsc);
    });
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', onClickOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const onEnter = () => {
    const t = setTimeout(() => setShowPreview(true), 450);
    setHoverTimer(t);
  };
  const onLeave = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    setHoverTimer(null);
    setShowPreview(false);
    // NB: do NOT close menu on mouse-leave — the menu item itself might be
    // outside the session-item's hover area. Click-outside handler above
    // does the real closing.
  };

  const firstAssistant = session.messages?.find(m => m.role === 'assistant');
  const snippet = firstAssistant?.content?.replace(/\n+/g, ' ').slice(0, 180) || 'No reply yet.';
  const msgCount = session.messages?.length || 0;

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

  const menuItems: Array<{ icon: React.ComponentType<{ size?: number }>; label: string; danger?: boolean; action: () => void }> = [
    { icon: Pencil, label: 'Rename', action: () => { setRenameVal(session.title); setRenameEditing(true); setMenuOpen(false); } },
    { icon: Pin, label: session.pinned ? 'Unpin' : 'Pin', action: () => { onPin(!session.pinned); setMenuOpen(false); } },
    { icon: Download, label: 'Export', action: () => { exportSession(); setMenuOpen(false); } },
    // Delete is a 2-step confirm: first click arms + relabels the menu item;
    // second click within 4s commits. Prevents accidental data loss from a
    // misclick in a small hover menu.
    {
      icon: Trash2,
      label: deleteArmed ? 'Click again to delete' : 'Delete',
      danger: true,
      action: () => {
        if (!deleteArmed) {
          setDeleteArmed(true);
          return;
        }
        onDelete();
        setMenuOpen(false);
        setDeleteArmed(false);
      },
    },
  ];

  return (
    <div ref={menuRootRef} className="group relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {renameEditing ? (
        <input
          autoFocus
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onBlur={() => { if (renameVal.trim()) onRename(renameVal.trim()); setRenameEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { if (renameVal.trim()) onRename(renameVal.trim()); setRenameEditing(false); }
            if (e.key === 'Escape') setRenameEditing(false);
          }}
          className="w-full pl-2 pr-2 py-1 rounded-md text-[12.5px] bg-surface border-hy fg-base outline-none"
        />
      ) : (
        <button
          onClick={onSelect}
          className={cx(
            'w-full text-left pl-2 pr-7 py-1 rounded-md text-[12.5px] truncate transition-colors focus-ring',
            active ? 'bg-subtle fg-base' : 'fg-subtle hover:bg-hover hover:fg-base'
          )}
        >{session.title}</button>
      )}
      {!renameEditing && (
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          aria-label="Session menu"
          className={cx(
            'absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded transition-opacity',
            menuOpen ? 'opacity-100 bg-hover' : 'opacity-0 group-hover:opacity-100 hover:bg-hover'
          )}
        >
          <MoreHorizontal size={14} className="fg-subtle" />
        </button>
      )}
      {showPreview && !menuOpen && !active && (
        <div className="session-preview anim-fade-in">
          <div className="sp-title">{session.title}</div>
          <div className="sp-snippet">{snippet}</div>
          <div className="sp-meta">
            <MessageSquare size={9} />
            {`${msgCount} messages`}
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', opacity: 0.5 }} />
            {relativeTime(session.updatedAt ?? session.createdAt)}
          </div>
        </div>
      )}
      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-36 rounded-md border-hy bg-surface anim-fade-in z-20 py-1"
          style={{ boxShadow: '0 10px 24px rgb(0 0 0 / 0.2)' }}
        >
          {menuItems.map((item, i) => {
            const IconC = item.icon;
            return (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); item.action(); }}
                className={cx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-hover transition-colors',
                  item.danger ? 'fg-danger' : 'fg-subtle'
                )}
              >
                <IconC size={13} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Sidebar;
