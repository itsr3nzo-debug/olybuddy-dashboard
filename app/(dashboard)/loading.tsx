import { Loader2 } from 'lucide-react'

/**
 * Route-level loading fallback.
 *
 * Lives at `app/(dashboard)/loading.tsx` so Next renders this any time
 * a dashboard route is suspended. v2: uses Lucide spinner + tokens
 * instead of raw `border-gray-200 border-t-indigo-600` Tailwind colours.
 *
 * Could be improved further by route-shaped skeletons (header + KPI
 * grid + table outlines) — flagged in DA pass as future polish.
 */
export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2
          size={20}
          strokeWidth={1.5}
          className="animate-spin text-muted-foreground"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}
