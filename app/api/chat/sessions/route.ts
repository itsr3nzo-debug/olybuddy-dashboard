import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClientId } from '@/lib/chat/resolve-client';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/** GET /api/chat/sessions?client=<uuid?> — list sessions for the resolved client. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const explicit = url.searchParams.get('client') || undefined;
  const { clientId, isAdminOverride } = resolveClientId(user, explicit);
  if (!clientId) return NextResponse.json({ sessions: [] });

  const reader = isAdminOverride
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;

  const { data, error } = await reader
    .from('agent_chat_sessions')
    .select('id, title, pinned, created_at, updated_at')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

/** POST /api/chat/sessions — create a new session for the resolved client. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let title = 'New chat';
  let explicit: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.title === 'string') title = body.title.slice(0, 120);
    if (typeof body?.client_id === 'string') explicit = body.client_id;
  } catch {
    // ignore — default title, no explicit
  }

  const { clientId, isAdminOverride } = resolveClientId(user, explicit);
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });

  const writer = isAdminOverride
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;

  const { data, error } = await writer
    .from('agent_chat_sessions')
    .insert({ client_id: clientId, user_id: user.id, title })
    .select('id, title, created_at, updated_at, pinned')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
