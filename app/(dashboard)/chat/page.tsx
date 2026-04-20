import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getUserSession } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import ChatApp from '@/components/chat/ChatApp';
import '@/styles/nexley-chat.css';

export const metadata: Metadata = { title: 'Chat | Nexley AI' };

interface ChatPageProps {
  searchParams: Promise<{ client?: string }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const session = getUserSession(user);
  const { client: queryClientId } = await searchParams;

  // ── Which client are we chatting as? ─────────────────────────────
  // owner/member: always their assigned client_id.
  // super_admin: picks a client via ?client=<uuid>. If none picked, they
  //   see a picker (client list) to choose.
  let activeClientId: string | null = null;
  if (session.role === 'super_admin') {
    activeClientId = queryClientId || null;
  } else {
    activeClientId = session.clientId;
  }

  // Super_admin without a selected client → render picker
  if (session.role === 'super_admin' && !activeClientId) {
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, name, slug, onboarding_completed, subscription_status')
      .order('name', { ascending: true });

    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Chat — admin view</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Pick a client to chat as their AI Employee. Messages go through that client&apos;s
          live agent on its own Hetzner VPS.
        </p>
        <div className="space-y-2">
          {(allClients ?? []).map((c) => (
            <a
              key={c.id}
              href={`/chat?client=${c.id}`}
              className="flex items-center justify-between rounded-md border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors px-4 py-3"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{c.name || c.slug}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {c.slug} · {c.subscription_status || 'no plan'} ·{' '}
                  {c.onboarding_completed ? 'onboarded' : 'onboarding'}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">→</span>
            </a>
          ))}
          {(!allClients || allClients.length === 0) && (
            <div className="text-sm text-muted-foreground">No clients yet.</div>
          )}
        </div>
      </div>
    );
  }

  if (!activeClientId) {
    return (
      <div className="p-8 text-sm text-destructive">
        No client assigned to your account. Contact support.
      </div>
    );
  }

  // Fetch business name + owner for the active client
  let clientName = 'My Business';
  let ownerName: string | undefined;
  const { data: client } = await supabase
    .from('clients')
    .select('name, contact_name')
    .eq('id', activeClientId)
    .maybeSingle();
  if (client?.name) clientName = client.name;
  if (typeof (client as { contact_name?: string } | null)?.contact_name === 'string') {
    ownerName = (client as { contact_name?: string }).contact_name;
  }

  return (
    <div className="h-[calc(100vh-80px)] lg:h-[calc(100vh-64px)] -m-4 sm:-m-6 lg:-m-8">
      <ChatApp
        clientId={activeClientId}
        clientName={clientName}
        userEmail={user.email || ''}
        ownerName={ownerName}
        isAdminView={session.role === 'super_admin'}
      />
    </div>
  );
}
