import type { Metadata } from 'next'
import EmptyState from '@/components/shared/EmptyState'
import { Star } from 'lucide-react'

export const metadata: Metadata = { title: 'Reviews | Nexley AI' }

export default function ReviewsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reviews</h1>
        <p className="text-sm mt-1 text-muted-foreground">Track and manage your business reviews</p>
      </div>

      <EmptyState
        icon={<Star size={24} />}
        title="Coming Soon"
        description="Review management will let you track Google reviews, send review requests, and compare against competitors."
        action={
          <a
            href="https://www.google.com/business/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Manage Google Business Profile
          </a>
        }
      />
    </div>
  )
}
