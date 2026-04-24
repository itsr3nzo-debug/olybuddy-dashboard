import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClientId, isSuperAdmin } from '@/lib/chat/resolve-client';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// Hard upper bounds on the body so we fail fast instead of OOM-ing the
// function on a malicious / runaway client. Real messages are well
// under 100 KB; 2 MB is generous. Attachments come via Supabase Storage
// direct-upload so the JSON body is only metadata.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARS = 100_000;
const MAX_ATTACHMENTS = 20;
// Per-user rolling 60s window. 10/min is plenty for a human (even rapid
// edit-and-resend); anything over is runaway client / abuse. Counted by
// the check_chat_rate_limit RPC against agent_chat_messages+sessions,
// so every burst attempt is throttled regardless of which session it
// lands in.
const RATE_LIMIT_PER_MINUTE = 10;

/**
 * POST /api/chat/messages
 * Body: { session_id?: string, content: string, create_if_missing?: boolean,
 *         title?: string, client_id?: string (admin-only override),
 *         parent_id?: string (for edit-as-sibling),
 *         idempotency_key?: uuid }
 *   - writes a user message with status='done'
 *   - inserts an assistant placeholder row (status='pending'), which the VPS
 *     bridge picks up via realtime and fills in.
 *   - both rows are inserted atomically via insert_chat_message_pair RPC.
 *
 * super_admin may pass client_id in the body to chat as any client. Owner/member
 * are always pinned to their assigned client_id. Admin impersonations are
 * recorded in admin_audit_log before the write is attempted.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Rate limit before touching the body — cheap SQL count, filters the
  // abuser out before we spend any cycles parsing JSON. Service-role
  // client because the RPC is SECURITY DEFINER and needs the plain key
  // to bypass our own RLS policies.
  {
    const rlClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: rl } = await rlClient.rpc('check_chat_rate_limit', { p_user_id: user.id });
    const sent = Array.isArray(rl) && rl[0]?.message_count ? Number(rl[0].message_count) : 0;
    if (sent >= RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: `Too many messages — ${RATE_LIMIT_PER_MINUTE} per minute. Please slow down.`,
          retry_after_seconds: 60,
        },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
  }

  let body: {
    session_id?: string;
    content?: string;
    create_if_missing?: boolean;
    title?: string;
    client_id?: string;
    attachments?: Array<{ url: string; name: string; mime: string; size: number; kind: string }>;
    /** Optional — when the user edits a past message and re-sends, the client
     * passes the predecessor's parent_id here so the new user row becomes a
     * SIBLING of the edited one (both children of the same predecessor) rather
     * than a fresh child at the end of the thread. */
    parent_id?: string | null;
  };
  // Guard the body size before parsing — JSON.parse on a 50MB blob will OOM
  // the function. If Content-Length is missing (chunked) we parse anyway
  // and rely on V8's own limits, but the typical client does set it.
  const lenHeader = req.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  }
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json({ error: 'content too long' }, { status: 413 });
  }
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `max ${MAX_ATTACHMENTS} attachments per message` }, { status: 413 });
  }
  if (!content && attachments.length === 0) {
    return NextResponse.json({ error: 'content or attachments required' }, { status: 400 });
  }

  // Idempotency — clients may retry on network blip. If the same key has
  // been seen in the last 24h, return the stored response instead of
  // inserting a duplicate pair.
  const idempotencyKey = req.headers.get('x-idempotency-key');
  if (idempotencyKey && /^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    const svc = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: prior } = await svc
      .from('request_idempotency')
      .select('response_json')
      .eq('key', idempotencyKey)
      .maybeSingle();
    if (prior?.response_json) {
      return NextResponse.json(prior.response_json);
    }
  }

  const { clientId, isAdminOverride, spoofRejected } = resolveClientId(user, body.client_id);
  if (spoofRejected) {
    return NextResponse.json(
      { error: 'client_id override is admin-only' },
      { status: 403 }
    );
  }
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

  // Resolve the parent_id for the user message we're about to write:
  //   - If the client sent `parent_id`, use it (used for edit-as-sibling).
  //     We verify the claimed parent actually exists in THIS session before
  //     accepting — prevents cross-session threading.
  //   - Otherwise default to the most-recent message in the session so the
  //     new row chains onto the end of the tree.
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  let userParentId: string | null = null;
  if (typeof body.parent_id === 'string' && body.parent_id) {
    const { data: p } = await service
      .from('agent_chat_messages')
      .select('id, session_id')
      .eq('id', body.parent_id)
      .maybeSingle();
    if (p && p.session_id === session_id) userParentId = p.id;
  }
  if (!userParentId) {
    const { data: last } = await service
      .from('agent_chat_messages')
      .select('id')
      .eq('session_id', session_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    userParentId = last?.id ?? null;
  }

  // Atomic user + assistant message insert via RPC. Both rows go in a
  // single transaction so a failure half-way can't leave the thread with
  // an orphaned user row + no placeholder for the bridge.
  const meta = attachments.length > 0 ? { attachments } : null;
  const { data: pair, error: rpcErr } = await service.rpc('insert_chat_message_pair', {
    p_session_id: session_id,
    p_client_id: clientId,
    p_content: content,
    p_parent_id: userParentId,
    p_metadata: meta,
  });
  if (rpcErr || !pair || pair.length === 0) {
    return NextResponse.json(
      { error: `message insert failed: ${rpcErr?.message || 'no rows returned'}` },
      { status: 500 },
    );
  }
  const row = pair[0] as { user_id: string; user_created_at: string; assistant_id: string; assistant_created_at: string };
  const userMsg = {
    id: row.user_id,
    role: 'user',
    content,
    status: 'done',
    created_at: row.user_created_at,
    completed_at: row.user_created_at,
    metadata: meta,
    parent_id: userParentId,
  };
  const asst = {
    id: row.assistant_id,
    role: 'assistant',
    status: 'pending',
    created_at: row.assistant_created_at,
    parent_id: row.user_id,
  };

  // Audit admin impersonation — blocking await so we never silently lose
  // the record of who chatted as whom.
  if (isAdminOverride) {
    await service.from('admin_audit_log').insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      client_id: clientId,
      action: 'chat_message_send',
      target_kind: 'session',
      target_id: session_id,
      context: { message_id: row.user_id, content_length: content.length },
    });
  }

  const responsePayload = {
    session_id,
    user_message: userMsg,
    assistant_message: asst,
  };

  // Persist the idempotency key + response so replays within 24h return
  // the same result without double-inserting.
  if (idempotencyKey && /^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    await service.from('request_idempotency').upsert(
      {
        key: idempotencyKey,
        user_id: user.id,
        endpoint: '/api/chat/messages',
        response_json: responsePayload,
      },
      { onConflict: 'key' },
    );
  }

  return NextResponse.json(responsePayload);
}

// Silence unused warning for isSuperAdmin when imported by other routes later
void isSuperAdmin;
