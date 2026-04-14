import Link from 'next/link'
import { Plug, ArrowRight } from 'lucide-react'

export default function IntegrationsCta() {
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-amber-900/30 flex items-center justify-center shrink-0">
        <Plug size={18} className="text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-200">Your AI Employee needs tools to work with.</p>
        <p className="text-xs text-amber-300/70 mt-0.5">Connect Gmail, Calendar, or QuickBooks so it can actually do things for you.</p>
      </div>
      <Link href="/integrations"
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 text-amber-950 text-xs font-semibold hover:bg-amber-400 transition-colors shrink-0">
        Connect now <ArrowRight size={14} />
      </Link>
    </div>
  )
}
