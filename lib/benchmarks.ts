/** Industry benchmarks for UK service businesses (hardcoded MVP) */

interface IndustryBenchmark {
  answerRate: number     // % of calls answered
  avgDuration: number    // seconds
  bookingRate: number    // % of calls that result in a booking
}

const BENCHMARKS: Record<string, IndustryBenchmark> = {
  landscaping:  { answerRate: 72, avgDuration: 85, bookingRate: 18 },
  plumbing:     { answerRate: 68, avgDuration: 72, bookingRate: 22 },
  electrical:   { answerRate: 70, avgDuration: 78, bookingRate: 20 },
  roofing:      { answerRate: 65, avgDuration: 90, bookingRate: 15 },
  cleaning:     { answerRate: 75, avgDuration: 65, bookingRate: 25 },
  default:      { answerRate: 70, avgDuration: 80, bookingRate: 20 },
}

export function getBenchmark(industry: string | null | undefined): IndustryBenchmark {
  if (!industry) return BENCHMARKS.default
  const key = industry.toLowerCase().trim()
  return BENCHMARKS[key] ?? BENCHMARKS.default
}

export function getPercentileBeat(yourValue: number, benchmarkValue: number): number {
  if (benchmarkValue === 0) return 50
  const ratio = yourValue / benchmarkValue
  // Simple linear interpolation: at benchmark = 50th percentile, 2x = 95th, 0.5x = 20th
  const percentile = Math.min(Math.max(Math.round(50 * ratio), 5), 99)
  return percentile
}

export function getIndustryLabel(industry: string | null | undefined): string {
  if (!industry) return 'service'
  return industry.toLowerCase().trim()
}
