'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Smooth out bursty content updates into a steady-pace typewriter reveal.
 *
 * The bridge writes to Supabase in ~40-char bursts (every ~1.5s or every
 * 40 chars of growth — whichever trips first). Without smoothing the
 * reply would appear in jumpy chunks. This hook interpolates between
 * whatever `target` is right now and the displayed text at ~60 chars/s,
 * using requestAnimationFrame so it drops to the browser's refresh rate.
 *
 * - When `active === false` (reply done or not yet started) we snap
 *   immediately to `target`.
 * - If the displayed text is more than 400 chars behind the target (big
 *   network burst), snap rather than make the user wait 6+ seconds.
 *
 * Returns the current displayed string.
 */
export function useSmoothedContent(
  target: string,
  active: boolean,
  charsPerSec = 60,
): string {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    // If streaming is off, just show whatever the target is.
    if (!active) {
      setDisplay(target);
      lastTickRef.current = 0;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Already caught up — nothing to animate.
    if (display === target) return;

    const step = (t: number) => {
      if (!lastTickRef.current) lastTickRef.current = t;
      const dt = t - lastTickRef.current;
      lastTickRef.current = t;
      const chars = Math.max(1, Math.round((charsPerSec * dt) / 1000));
      setDisplay((prev) => {
        if (prev === target) return prev;
        // Network burst — if we're more than 400 chars behind, snap.
        // Prevents a user from waiting ~7s to catch up after a big push.
        if (target.length - prev.length > 400) return target;
        // Prefix of `target` avoids drifting into inconsistent state if
        // the target SHRINKS (the bridge occasionally retracts a partial
        // reply if the extractor latches onto a different block). We
        // reveal up to min(target.length, prev.length + chars).
        if (!target.startsWith(prev)) {
          // Target diverged — jump to the new target to stay consistent.
          return target;
        }
        return target.slice(0, Math.min(target.length, prev.length + chars));
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = 0;
    };
    // display is intentionally omitted — we read it via the functional
    // setter so we don't need it as a dep. Including it would restart
    // the RAF on every frame, which is exactly what we want to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, charsPerSec]);

  return display;
}
