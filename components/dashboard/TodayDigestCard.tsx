'use client'

/**
 * TodayDigestCard — "do I need to do anything?"
 *
 * The ONE widget that answers the question every customer is silently
 * asking when they log in.
 *
 * v3 — DA-driven correction:
 *   The previous version derived `awaitingReplyCount`, `bookedCount`,
 *   `quotedCount` and `lostCount` from `outcome` / `needs_owner_action`
 *   columns on `call_logs`. Those columns DO NOT EXIST in the DB
 *   schema (verified). Cast-through-unknown made the build pass but
 *   the values were always 0 at runtime, which made the card always
 *   render the misleading "All clear ✓" state regardless of what was
 *   actually waiting for the user.
 *
 *   We now refuse to make claims we can't back up. The card shows
 *   only what we can credibly count from the existing data:
 *   yesterday's conversation volume + a link into the inbox. No
 *   "needs your eyes" claim, no booked/quoted/lost breakdown, until
 *   the data exists.
 *
 *   When we eventually ship `outcome` / `needs_owner_action` (or pivot
 *   to a comms_log unanswered-inbound query), the optional `breakdown`
 *   prop and the optional `awaitingReplyCount` prop come back online
 *   automatically. Until then the card stays honest.
 */

import Link from 'next/link'
import { motion } from 'motion/react'
import { ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TodayDigestProps {
  /** Conversations Ava completed yesterday (calls + inbound messages combined) */
  handledCount: number
  /**
   * Optional: number of conversations where the OWNER needs to reply.
   * Only pass this when you can count it accurately. Pass `undefined`
   * (or omit) when you can't — the card will not invent a "needs your
   * eyes" claim.
   */
  awaitingReplyCount?: number
  /**
   * Optional: outcome breakdown. Only pass when you can count each
   * bucket from real data. Each field is independently optional.
   */
  breakdown?: {
    booked?: number
    quoted?: number
    lost?: number
  }
  /** Optional href for the "Open" CTA — defaults to /conversations */
  href?: string
}

export default function TodayDigestCard({
  handledCount,
  awaitingReplyCount,
  breakdown,
  href = '/conversations',
}: TodayDigestProps) {
  // No traffic = no card. Don't claim "Ava handled 0 conversations" as
  // a result.
  if (handledCount === 0) return null

  // Only claim "needs your eyes" if the caller passed a real number.
  // `undefined` means "we don't know" and we should NOT default to
  // claiming "all clear".
  const knowsAttention = typeof awaitingReplyCount === 'number'
  const needsAttention = knowsAttention && (awaitingReplyCount ?? 0) > 0

  const conversationLabel = handledCount === 1 ? 'conversation' : 'conversations'

  // Build the breakdown row only if at least one field is provided.
  const hasBreakdown =
    breakdown !== undefined &&
    (breakdown.booked !== undefined ||
      breakdown.quoted !== undefined ||
      breakdown.lost !== undefined)

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-card p-4 mb-6',
        // Accent strip — primary navy when there's something to do,
        // dim muted otherwise. The success-green-when-clear was overclaiming
        // (we couldn't prove "clear" without the awaiting-reply data) so
        // we drop the green and let the card stay neutral when we don't know.
        needsAttention
          ? 'border-border shadow-[inset_2px_0_0_0_var(--primary)]'
          : 'border-border',
      )}
      aria-label="Yesterday's summary"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Headline — the answer to "do I need to do anything?" */}
          <h2 className="text-base font-semibold tracking-tight text-foreground leading-snug">
            {needsAttention ? (
              <>
                Yesterday: Ava handled{' '}
                <span className="font-mono tabular-nums">{handledCount}</span> {conversationLabel}.
                <br />
                <span className="text-primary">
                  <span className="font-mono tabular-nums">{awaitingReplyCount}</span>{' '}
                  {(awaitingReplyCount ?? 0) === 1 ? 'needs' : 'need'} your eyes.
                </span>
              </>
            ) : (
              <>
                Yesterday Ava handled{' '}
                <span className="font-mono tabular-nums">{handledCount}</span> {conversationLabel}.
              </>
            )}
          </h2>

          {/* Sub-stat row — only renders when we have at least one
              real breakdown number. No phantom "0 booked · 0 quoted ·
              0 lost" line claiming false data. */}
          {hasBreakdown && (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              {breakdown!.booked !== undefined && (
                <>
                  <span className="font-mono text-foreground">{breakdown!.booked}</span> booked
                </>
              )}
              {breakdown!.quoted !== undefined && (
                <>
                  {breakdown!.booked !== undefined && (
                    <span className="text-muted-foreground/50 mx-1.5">·</span>
                  )}
                  <span className="font-mono text-foreground">{breakdown!.quoted}</span> quoted
                </>
              )}
              {breakdown!.lost !== undefined && (
                <>
                  {(breakdown!.booked !== undefined || breakdown!.quoted !== undefined) && (
                    <span className="text-muted-foreground/50 mx-1.5">·</span>
                  )}
                  <span className="font-mono text-foreground">{breakdown!.lost}</span> lost
                </>
              )}
            </p>
          )}
        </div>

        {/* Right-side affordance.
            - Action needed: primary CTA into the inbox.
            - Otherwise: a quiet "Open" link. We can't honestly claim
              "all clear ✓" without ground-truth on what's awaiting a
              reply, so the success-tick state is removed until that
              data exists. */}
        <div className="shrink-0 mt-0.5">
          <Link
            href={href}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              needsAttention
                ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95'
                : 'border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 active:bg-muted/60',
            )}
          >
            Open
            {needsAttention ? (
              <ArrowRight size={14} strokeWidth={1.75} />
            ) : (
              <Check size={14} strokeWidth={1.75} className="text-muted-foreground/60" aria-hidden />
            )}
          </Link>
        </div>
      </div>
    </motion.section>
  )
}
