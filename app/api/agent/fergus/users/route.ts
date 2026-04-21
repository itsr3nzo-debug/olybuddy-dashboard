import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent-auth'
import { safeErrorDetail } from '@/lib/agent-trust-gate'
import { FergusClient } from '@/lib/integrations/fergus'

/** GET /api/agent/fergus/users — list team members in the Fergus org */
export async function GET(req: NextRequest) {
  const auth = await authenticateAgent(req)
  if (auth instanceof NextResponse) return auth
  try {
    const client = await FergusClient.forClient(auth.clientId)
    const users = await client.listUsers()
    return NextResponse.json({ count: users.length, users })
  } catch (e) {
    return NextResponse.json({ error: 'fergus_list_users_failed', detail: safeErrorDetail(e) }, { status: 502 })
  }
}
