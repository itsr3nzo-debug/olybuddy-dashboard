"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Table primitives — v2.
 *
 * Stripe / Linear / Mercury pattern:
 * - Row height target 36px desktop (compact, no zebra), 44px touch
 * - Column header: 32px tall, small-caps 11px tracking-wider, muted
 * - 1px hairline row dividers (no zebra striping — research confirmed
 *   modern premium tables drop alternating bg)
 * - Hover-only row affordance (subtle bg shift)
 * - Numbers right-aligned, paired with `font-mono tabular-nums`
 * - Sticky header optional via prop
 *
 * Backwards-compatible:
 *   <Table>, <TableHeader>, <TableBody>, <TableHead>, <TableRow>,
 *   <TableCell>, <TableCaption>, <TableFooter> — all still exported
 *   with new defaults applied. No callsite changes needed; the visual
 *   refresh propagates via tokens + class updates.
 */

interface TableProps extends React.ComponentProps<"table"> {
  /** Sticky header — useful in long tables (conversations, contacts) */
  stickyHeader?: boolean
  /** Compact rows (28px) — for very dense data like contacts directory */
  compact?: boolean
}

function Table({ className, stickyHeader, compact, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'relative w-full overflow-x-auto',
        // Hairline border around the whole table for "panel" feel.
        // Use rounded-lg (8px) to match Card.
        'rounded-lg border border-border bg-card',
      )}
    >
      <table
        data-slot="table"
        data-compact={compact || undefined}
        data-sticky-header={stickyHeader || undefined}
        className={cn(
          'w-full caption-bottom text-sm border-separate border-spacing-0',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        // Sticky behaviour controlled by parent table data-attribute
        '[&_tr]:hover:bg-transparent',
        // Small-caps treatment on every header cell
        '[&_th]:h-8 [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground',
        // Bottom hairline divider beneath the header
        '[&_th]:border-b [&_th]:border-border',
        // Sticky header support — toggled by data-sticky-header on table
        '[[data-sticky-header]_&_th]:sticky [[data-sticky-header]_&_th]:top-0 [[data-sticky-header]_&_th]:bg-card [[data-sticky-header]_&_th]:z-10',
        className,
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        // Last row has no bottom border (table border owns it)
        '[&_tr:last-child_td]:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        '[&_td]:border-t [&_td]:border-border [&_td]:bg-muted/30',
        '[&_td]:font-medium [&_td]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // Subtle hover. No zebra striping.
        'transition-colors',
        'hover:bg-muted/40',
        'has-aria-expanded:bg-muted/60 data-[state=selected]:bg-muted/60',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // Padding tuned for 32px header height
        'px-3 text-left align-middle whitespace-nowrap',
        '[&:has([role=checkbox])]:pr-0',
        // First/last column extra padding for visual breathing room
        'first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // Padding gives 36px row height with text-sm content
        'px-3 py-2.5 align-middle whitespace-nowrap',
        // Compact rows (28px)
        '[[data-compact]_&]:py-1.5',
        // Hairline row divider on the cell, not the row, so it follows
        // border-collapse semantics with separated borders.
        'border-b border-border',
        '[&:has([role=checkbox])]:pr-0',
        // First/last column extra padding
        'first:pl-4 last:pr-4',
        // Default cell text colour matches body
        'text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/**
 * TableNumberCell — convenience wrapper for numeric cells.
 * Right-aligned, mono, tabular-nums. Use for £, message counts,
 * timestamps, durations, IDs.
 */
function TableNumberCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn('text-right font-mono tabular-nums', className)}
      {...props}
    />
  )
}

/**
 * TableActionCell — last column, hover-revealed action buttons.
 * Visible by default on touch devices (where hover doesn't exist),
 * fades in on hover for desktop.
 */
function TableActionCell({ className, children, ...props }: React.ComponentProps<"td">) {
  return (
    <TableCell
      className={cn(
        'text-right w-px',
        // Hide on desktop until row hover. Always visible on touch.
        'opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100',
        'transition-opacity',
        className,
      )}
      {...props}
    >
      {children}
    </TableCell>
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-3 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableNumberCell,
  TableActionCell,
  TableCaption,
}
