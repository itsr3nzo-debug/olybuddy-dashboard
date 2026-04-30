'use client'

import { motion } from 'motion/react'
import { getBenchmark, getPercentileBeat, getIndustryLabel } from '@/lib/benchmarks'
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react'

interface BenchmarkCardProps {
  answerRate: number
  avgDuration: number
  bookingRate: number
  industry: string | null
}

function BenchmarkRow({ label, yourValue, benchmarkValue, suffix, industry }: {
  label: string; yourValue: number; benchmarkValue: number; suffix: string; industry: string
}) {
  const beating = yourValue >= benchmarkValue
  const percentile = getPercentileBeat(yourValue, benchmarkValue)

  return (
    <div className="py-3 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-foreground">{yourValue}{suffix}</span>
          <span className="text-xs text-muted-foreground">vs {benchmarkValue}{suffix} avg</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {beating ? (
          <TrendingUp size={12} className="text-brand-success" />
        ) : (
          <TrendingDown size={12} className="text-brand-danger" />
        )}
        <span className={`text-xs font-medium ${beating ? 'text-brand-success' : 'text-brand-danger'}`}>
          {beating
            ? `Better than ${percentile}% of UK ${industry} businesses`
            : `Below average — room to improve`
          }
        </span>
      </div>
    </div>
  )
}

export default function BenchmarkCard({ answerRate, avgDuration, bookingRate, industry }: BenchmarkCardProps) {
  const benchmark = getBenchmark(industry)
  const label = getIndustryLabel(industry)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-xl border p-6 bg-card"
    >
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={16} className="text-brand-warning" />
        <h3 className="text-sm font-semibold text-foreground">Industry Benchmarks</h3>
      </div>

      <BenchmarkRow label="Answer Rate" yourValue={answerRate} benchmarkValue={benchmark.answerRate} suffix="%" industry={label} />
      <BenchmarkRow label="Avg Call Duration" yourValue={avgDuration} benchmarkValue={benchmark.avgDuration} suffix="s" industry={label} />
      <BenchmarkRow label="Booking Rate" yourValue={bookingRate} benchmarkValue={benchmark.bookingRate} suffix="%" industry={label} />
    </motion.div>
  )
}
