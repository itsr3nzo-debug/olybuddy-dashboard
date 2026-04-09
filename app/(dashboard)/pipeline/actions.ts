'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PipelineStage } from '@/lib/types'

const VALID_STAGES: PipelineStage[] = ['new', 'contacted', 'qualified', 'demo_booked', 'demo_done', 'proposal', 'negotiation', 'won', 'lost']

export async function updateOpportunityStage(opportunityId: string, newStage: PipelineStage) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const clientId = user.app_metadata?.client_id
  if (!clientId) throw new Error('No client linked')

  if (!VALID_STAGES.includes(newStage)) throw new Error('Invalid stage')

  // Get opportunity + contact_id for activity log
  const { data: opp, error: fetchErr } = await supabase
    .from('opportunities')
    .select('id, contact_id, stage')
    .eq('id', opportunityId)
    .eq('client_id', clientId)
    .single()

  if (fetchErr || !opp) throw new Error('Opportunity not found')
  if (opp.stage === newStage) return // No change needed

  // Update stage
  const { error: updateErr } = await supabase
    .from('opportunities')
    .update({ stage: newStage })
    .eq('id', opportunityId)
    .eq('client_id', clientId)

  if (updateErr) throw new Error(updateErr.message)

  // Log activity
  await supabase.from('activities').insert({
    client_id: clientId,
    contact_id: opp.contact_id,
    activity_type: 'stage_change',
    description: `Moved from ${opp.stage} to ${newStage}`,
    metadata: { opportunity_id: opportunityId, from_stage: opp.stage, to_stage: newStage },
  })

  revalidatePath('/pipeline')
}
