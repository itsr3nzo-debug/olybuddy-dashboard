import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClientId, isSuperAdmin } from '@/lib/chat/resolve-client';
import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * POST /api/chat/messages
 * Body: { session_id?: string, content: string, create_if_missing?: boolean,
 *         title?: string, client_id?: string (admin-only override) }
 *   - writes a user message with status='done'
 *   - inserts an assistant placeholder row (status='pending'), which the VPS
 *     bridge picks up via realtime and fills in.
 *
 * super_admin may pass client_id in the body to chat as any client. Owner/member
 * are always pinned to their assigned client_id.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: {
    session_id?: string;
    content?: string;
    create_if_missing?: boolean;
    title?: string;
    client_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : undefined;
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const { clientId, isAdminOverride } = resolveClientId(user, body.client_id);
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });

  // Admin override → use service-role client (bypasses RLS which is bound to
  // the admin's own JWT). Regular users keep their scoped supabase client.
  const writer = isAdminOverride
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;

  let session_id = body.session_id;

  if (!session_id && body.create_if_missing) {
    const autoTitle = body.title || (content.length > 48 ? content.slice(0, 48) + '…' : content);
    const { data: sess, error } = await writer
      .from('agent_chat_sessions')
      .insert({ client_id: clientId, user_id: user.id, title: autoTitle })
      .select('id')
      .single();
    if (error || !sess) {
      return NextResponse.json({ error: error?.message || 'could not create session' }, { status: 500 });
    }
    session_id = sess.id;
  }
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  // 1. User message
  const { data: userMsg, error: uErr } = await writer
    .from('agent_chat_messages')
    .insert({
      session_id,
      client_id: clientId,
      role: 'user',
      content,
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .select('id, role, content, status, created_at, completed_at')
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // 2. Assistant placeholder — always written with service role because RLS
  //    restricts INSERT role='user' only for clients, and assistant rows
  //    come from the VPS anyway.
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: asst, error: aErr } = await service
    .from('agent_chat_messages')
    .insert({
      session_id,
      client_id: clientId,
      role: 'assistant',
      content: '',
      status: 'pending',
    })
    .select('id, role, status, created_at')
    .single();

  if (aErr || !asst) {
    return NextResponse.json(
      { error: `assistant placeholder: ${aErr?.message || 'unknown'}` },
      { status: 500 }
    );
  }

  if (isAdminOverride) console.log(`[admin] ${user.email} chatted as client ${clientId}`);

  return NextResponse.json({
    session_id,
    user_message: userMsg,
    assistant_message: asst,
  });
}

// Silence unused warning for isSuperAdmin when imported by other routes later
void isSuperAdmin;
