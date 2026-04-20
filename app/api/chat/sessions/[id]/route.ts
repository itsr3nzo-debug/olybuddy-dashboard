import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClientId } from '@/lib/chat/resolve-client';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function writerFor(supabase: Awaited<ReturnType<typeof createClient>>, isAdmin: boolean) {
  if (!isAdmin) return supabase;
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** GET /api/chat/sessions/:id?client=<uuid?> */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const explicit = new URL(req.url).searchParams.get('client') || undefined;
  const { clientId, isAdminOverride } = resolveClientId(user, explicit);
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });
  const reader = writerFor(supabase, isAdminOverride);

  const [sessRes, msgsRes] = await Promise.all([
    reader
      .from('agent_chat_sessions')
      .select('id, title, pinned, created_at, updated_at, client_id')
      .eq('id', id)
      .maybeSingle(),
    reader
      .from('agent_chat_messages')
      .select('id, role, content, status, sources, error_message, created_at, completed_at, metadata')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (sessRes.error) return NextResponse.json({ error: sessRes.error.message }, { status: 500 });
  if (!sessRes.data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (sessRes.data.client_id !== clientId)
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (msgsRes.error) return NextResponse.json({ error: msgsRes.error.message }, { status: 500 });

  return NextResponse.json({ session: sessRes.data, messages: msgsRes.data ?? [] });
}

/** PATCH /api/chat/sessions/:id — rename / pin / unpin. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let patch: { title?: string; pinned?: boolean; client_id_hint?: string } = {};
  try {
    const body = await req.json();
    if (typeof body?.title === 'string') patch.title = body.title.slice(0, 120);
    if (typeof body?.pinned === 'boolean') patch.pinned = body.pinned;
    if (typeof body?.client_id === 'string') patch.client_id_hint = body.client_id;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (typeof patch.title !== 'string' && typeof patch.pinned !== 'boolean')
    return NextResponse.json({ error: 'no fields' }, { status: 400 });

  const { clientId, isAdminOverride } = resolveClientId(user, patch.client_id_hint);
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });
  const writer = writerFor(supabase, isAdminOverride);

  const update: { title?: string; pinned?: boolean } = {};
  if (typeof patch.title === 'string') update.title = patch.title;
  if (typeof patch.pinned === 'boolean') update.pinned = patch.pinned;

  const { data, error } = await writer
    .from('agent_chat_sessions')
    .update(update)
    .eq('id', id)
    .eq('client_id', clientId)
    .select('id, title, pinned, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

/** DELETE /api/chat/sessions/:id */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const explicit = new URL(req.url).searchParams.get('client') || undefined;
  const { clientId, isAdminOverride } = resolveClientId(user, explicit);
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });
  const writer = writerFor(supabase, isAdminOverride);

  const { error } = await writer
    .from('agent_chat_sessions')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
