import type { Metadata } from 'next'
import IntegrationsPage from '@/components/integrations/IntegrationsPage'

export const metadata: Metadata = { title: 'Integrations | Olybuddy' }

export default function Page() {
  return <IntegrationsPage />
}
