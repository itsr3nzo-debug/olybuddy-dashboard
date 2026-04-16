/**
 * GET /api/agent/health
 *
 * Deployment-freshness check. The VPS worker and apply-sender-roles.sh hit
 * this to verify the dashboard deployment is up-to-date enough to serve the
 * agent's skill APIs. If any required endpoint from this session is missing,
 * the operator needs to deploy.
 *
 * Returns the list of agent-facing features this build supports. Compare
 * against the required list client-side to detect a stale deploy.
 */

import { NextResponse } from 'next/server'

const DEPLOY_VERSION = 'trades-ops-v1-2026-04-16'

const AGENT_FEATURES = [
  'log-action',
  'captured-jobs',
  'variations',
  'supplier-products',
  'pricing-rules',
  'weekly-stats',
  'provisioning-status',
  'estimates-upload-with-vision',
]

export async function GET() {
  return NextResponse.json({
    ok: true,
    deploy_version: DEPLOY_VERSION,
    features: AGENT_FEATURES,
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
    supabase_configured: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
    timestamp: new Date().toISOString(),
  })
}
