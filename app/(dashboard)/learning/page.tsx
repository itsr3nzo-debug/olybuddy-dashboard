import type { Metadata } from 'next'
import LearningPage from '@/components/learning/LearningPage'

export const metadata: Metadata = { title: 'Learning | Nexley AI' }

export default function Page() {
  return <LearningPage />
}
