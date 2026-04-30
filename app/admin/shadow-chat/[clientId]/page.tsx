import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserSession } from '@/lib/rbac';
import { auditAdmin } from '@/lib/chat/audit';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import ShadowChatView from './ShadowChatView';

export const metadata = { title: 'Observing · Nexley admin' };

export default async function ShadowChatPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const session = getUserSession(user);
  if (session.role !== 'super_admin') redirect('/dashboard');

  // Service-role read to bypass the admin-has-no-client_id RLS gap.
  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const [{ data: client }, { data: sessions }] = await Promise.all([
    service.from('clients').select('id, name, slug, contact_name').eq('id', clientId).maybeSingle(),
    service
      .from('agent_chat_sessions')
      .select('id, title, created_at, updated_at, pinned')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);
  if (!client) notFound();

  await auditAdmin(
    { id: user.id, email: user.email ?? '' },
    'admin_view_start',
    { clientId, targetKind: 'client', targetId: clientId, context: { slug: client.slug } }
  );

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-5">
        <Link href="/admin/shadow-chat" className="text-xs text-muted-foreground hover:underline">← All clients</Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mt-1">
          Observing: <span className="font-medium">{client.name}</span>
        </h1>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-500 px-2 py-0.5 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            Shadow mode · read-only
          </span>
          <span>slug: <span className="font-mono">{client.slug}</span></span>
          <span>·</span>
          <Link href={`/chat?client=${client.id}`} className="underline">Chat AS this client →</Link>
        </div>
      </div>

      <ShadowChatView clientId={client.id} initialSessions={sessions ?? []} />
    </div>
  );
}
