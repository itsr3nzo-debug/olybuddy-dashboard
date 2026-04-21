import { NextResponse } from 'next/server'

/**
 * POST /api/agent/fergus/jobs/<id>/complete — NOT SUPPORTED.
 *
 * Fergus Partner API has no `/complete` endpoint. Verified against
 * api.fergus.com/docs/json. Jobs transition to completed implicitly on
 * invoicing; for pause/resume semantics use:
 *   - POST /api/agent/fergus/jobs/{id}/hold
 *   - POST /api/agent/fergus/jobs/{id}/resume
 */
export async function POST() {
  return NextResponse.json({
    error: 'not_supported',
    reason: 'Fergus Partner API has no POST /jobs/{id}/complete endpoint.',
    alternatives: [
      'POST /api/agent/fergus/jobs/{id}/hold — pause the job',
      'POST /api/agent/fergus/jobs/{id}/resume — resume a held job',
      'Mark the job complete inside the Fergus UI',
    ],
  }, { status: 501 })
}

export async function PUT() {
  return POST()
}
