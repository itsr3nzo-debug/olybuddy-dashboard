import { createClient } from '@/lib/supabase/server';
import { getUserSession } from '@/lib/rbac';
import { auditAdmin } from '@/lib/chat/audit';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const metadata = { title: 'Shadow chat — Nexley admin' };

/**
 * Admin shadow-chat landing page: pick a client to OBSERVE (read-only).
 * For actively chatting as a client, use /chat?client=<uuid> instead.
 */
export default async function ShadowChatIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const session = getUserSession(user);
  if (session.role !== 'super_admin') redirect('/dashboard');

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug, subscription_status')
    .order('name', { ascending: true });

  await auditAdmin(
    { id: user.id, email: user.email ?? '' },
    'admin_shadow_open',
    { context: { page: 'index' } }
  );

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Shadow chat</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only observer of any client&apos;s AI Employee conversations. Every open is audited.
          For chatting AS a client, use the <Link className="underline" href="/chat">chat picker</Link>.
        </p>
      </div>
      <div className="space-y-2">
        {(clients ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/admin/shadow-chat/${c.id}`}
            className="flex items-center justify-between rounded-md border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors px-4 py-3"
          >
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate">{c.name || c.slug}</span>
              <span className="text-xs text-muted-foreground">
                {c.slug} · {c.subscription_status || 'no plan'}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">Observe →</span>
          </Link>
        ))}
        {(!clients || clients.length === 0) && (
          <div className="text-sm text-muted-foreground">No clients.</div>
        )}
      </div>
    </div>
  );
}
