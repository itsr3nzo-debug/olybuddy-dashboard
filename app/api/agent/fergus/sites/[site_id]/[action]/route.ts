import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/**
 * POST /api/agent/fergus/sites/<site_id>/<action>
 * action ∈ {archive, restore}
 */
const ActionSchema = z.enum(['archive', 'restore'])

export async function POST(req: NextRequest, { params }: { params: Promise<{ site_id: string; action: string }> }) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  const { site_id, action } = await params
  const id = parseInt(site_id, 10)
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid site_id' }, { status: 400 })
  const a = ActionSchema.safeParse(action)
  if (!a.success) return NextResponse.json({ error: 'invalid action', allowed: ActionSchema.options }, { status: 400 })
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const result = a.data === 'archive' ? await client.archiveSite(id) : await client.restoreSite(id)
    return NextResponse.json({ site: result, action: a.data })
  } catch (e) {
    return NextResponse.json({ error: `fergus_site_${a.data}_failed`, detail: safeErrorDetail(e) }, { status: 502 })
  }
}
