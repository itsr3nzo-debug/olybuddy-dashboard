import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * GET /api/cron/chat-sweeper
 *
 * Vercel cron (every 15 minutes) — calls the DB sweeper to mark any
 * assistant agent_chat_messages that have been pending/thinking/drafting
 * for > 2 minutes as errored. Complements the client-side 25s sweeper
 * (which only updates local state) so the DB doesn't accumulate zombie
 * rows that look stuck to anyone re-opening the session.
 */

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await service.rpc('sweep_stuck_agent_chat');
  if (error) {
    console.error('[cron/chat-sweeper]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ swept: data ?? 0 });
}
