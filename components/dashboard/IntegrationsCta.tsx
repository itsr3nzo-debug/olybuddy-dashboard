import { Plug } from 'lucide-react'
import { BannerShell, BannerAction } from '@/components/ui/banner'

/**
 * IntegrationsCta — v2.
 *
 * Repurposed to use the BannerShell primitive — now reads as a status
 * banner, not a marketing card. Same warning intent, same message,
 * same destination — just consistent visual language with the trial /
 * email-verification banners stacked above.
 */
export default function IntegrationsCta() {
  return (
    <BannerShell intent="warning" icon={Plug}>
      <span className="font-medium">Your AI Employee needs tools to work with.</span>
      <span className="text-muted-foreground ml-2">
        Connect Gmail, Calendar, or QuickBooks so it can actually do things for you.
      </span>
      <BannerAction href="/integrations" intent="warning">
        Connect
      </BannerAction>
    </BannerShell>
  )
}
