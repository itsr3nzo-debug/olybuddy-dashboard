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
    attachments?: Array<{ url: string; name: string; mime: string; size: number; kind: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: 'content or attachments required' }, { status: 400 });
  }

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

  // Auto-title the session from its first user message if it still has a
  // placeholder title ("New chat" / "Chat" / "").
  try {
    const { data: sess } = await writer
      .from('agent_chat_sessions')
      .select('title')
      .eq('id', session_id)
      .maybeSingle();
    const placeholder = !sess?.title || /^(new chat|chat|untitled)$/i.test(String(sess.title).trim());
    if (placeholder) {
      const seed = content || (attachments[0]?.name ?? 'Attachment');
      const autoTitle = seed.length > 48 ? seed.slice(0, 48) + '…' : seed;
      await writer.from('agent_chat_sessions').update({ title: autoTitle }).eq('id', session_id);
    }
  } catch {
    /* non-fatal */
  }

  // 1. User message
  const userPayload: Record<string, unknown> = {
    session_id,
    client_id: clientId,
    role: 'user',
    content,
    status: 'done',
    completed_at: new Date().toISOString(),
  };
  if (attachments.length > 0) userPayload.metadata = { attachments };
  const { data: userMsg, error: uErr } = await writer
    .from('agent_chat_messages')
    .insert(userPayload)
    .select('id, role, content, status, created_at, completed_at, metadata')
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
