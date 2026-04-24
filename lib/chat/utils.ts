import type { Session } from './types';

/** Tailwind-style className joiner. Accepts strings, arrays, falsy. */
export function cx(...args: Array<string | false | null | undefined | Array<string | false | null | undefined>>): string {
  return args.flat().filter((v): v is string => Boolean(v)).join(' ');
}

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return 'just now';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const now = Date.now();
  const diff = Math.round((now - then) / 1000);
  if (diff < 0) return 'just now';
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.round(diff / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Absolute, pinpoint-accurate timestamp for hover tooltips. Visible
 * bubbles keep the relative label ("2 min ago") because it matches how
 * humans think; the tooltip gives them the exact moment when they
 * actually need it (debugging, citing, scrolling far back in history).
 *
 * Uses the caller's locale + timezone via `Intl.DateTimeFormat` with
 * `dateStyle: 'medium'` and `timeStyle: 'short'` so it reads
 * naturally in en-GB ("24 Apr 2026, 14:23"), en-US ("Apr 24, 2026,
 * 2:23 PM"), de-DE, etc. without any manual formatting.
 */
export function absoluteTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch {
    // Intl.DateTimeFormat options are widely supported but fall back
    // gracefully on ancient engines.
    return d.toLocaleString();
  }
}

export function groupSessionsByDate(sessions: Session[]): Array<[string, Session[]]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);
  const monthStart = new Date(today);
  monthStart.setDate(today.getDate() - 30);

  const groups: Record<string, Session[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    'This month': [],
    Older: [],
  };
  for (const s of sessions) {
    const t = new Date(s.createdAt).getTime();
    if (t >= today.getTime()) groups.Today.push(s);
    else if (t >= yesterday.getTime()) groups.Yesterday.push(s);
    else if (t >= weekStart.getTime()) groups['This week'].push(s);
    else if (t >= monthStart.getTime()) groups['This month'].push(s);
    else groups.Older.push(s);
  }
  return Object.entries(groups).filter(([, arr]) => arr.length > 0);
}
