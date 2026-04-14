import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ConversationsLayout from '@/components/conversations/ConversationsLayout'
import EmptyState from '@/components/shared/EmptyState'
import { MessageSquare } from 'lucide-react'

export const metadata: Metadata = { title: 'Inbox | Nexley AI' }

export default async function ConversationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id

  let contacts: Array<Record<string, unknown>> = []
  let messages: Array<Record<string, unknown>> = []

  if (clientId) {
    const [contactsRes, messagesRes] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email, company')
        .eq('client_id', clientId)
        .order('last_contacted', { ascending: false }),
      supabase
        .from('comms_log')
        .select('id, contact_id, channel, direction, body, status, sent_at')
        .eq('client_id', clientId)
        .order('sent_at', { ascending: false })
        .limit(200),
    ])

    contacts = (contactsRes.data ?? []) as Array<Record<string, unknown>>
    messages = (messagesRes.data ?? []) as Array<Record<string, unknown>>
  }

  return (
    <div className="h-[calc(100vh-120px)] lg:h-[calc(100vh-80px)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Inbox</h1>
        <p className="text-sm mt-1 text-muted-foreground">All conversations in one place</p>
      </div>

      {contacts.length > 0 || messages.length > 0 ? (
        <ConversationsLayout
          contacts={contacts}
          messages={messages}
          clientId={clientId ?? ''}
        />
      ) : (
        <EmptyState
          icon={<MessageSquare size={24} />}
          title="No conversations yet"
          description="Messages will appear here when your AI Employee starts communicating with customers via SMS, WhatsApp, or email."
        />
      )}
    </div>
  )
}
