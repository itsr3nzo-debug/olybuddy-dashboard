'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/format'
import { MessageSquare, Mail, Send, Phone as PhoneIcon } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'

interface Contact {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  company: string | null
}

interface Message {
  id: string
  contact_id: string | null
  channel: string
  direction: string
  body: string | null
  status: string
  sent_at: string
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  sms: <MessageSquare size={12} />,
  whatsapp: <MessageSquare size={12} />,
  email: <Mail size={12} />,
  telegram: <Send size={12} />,
}

const CHANNEL_COLORS: Record<string, string> = {
  sms: 'text-brand-success',
  whatsapp: 'text-green-500',
  email: 'text-brand-info',
  telegram: 'text-blue-400',
}

interface ConversationsLayoutProps {
  contacts: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  clientId: string
}

export default function ConversationsLayout({ contacts: rawContacts, messages: rawMessages, clientId }: ConversationsLayoutProps) {
  const contacts = rawContacts as unknown as Contact[]
  const allMessages = rawMessages as unknown as Message[]

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [threadMessages, setThreadMessages] = useState<Message[]>([])
  const [search, setSearch] = useState('')
  const threadEndRef = useRef<HTMLDivElement>(null)
  const supabaseRef = useRef(createClient())

  // Build contact list with latest message
  const contactsWithLastMsg = contacts.map(c => {
    const msgs = allMessages.filter(m => m.contact_id === c.id)
    const lastMsg = msgs[0]
    const unread = msgs.filter(m => m.direction === 'inbound' && m.status !== 'read').length
    return { ...c, lastMsg, unread }
  }).filter(c => c.lastMsg || true) // Show all contacts even without messages
    .sort((a, b) => {
      if (!a.lastMsg) return 1
      if (!b.lastMsg) return -1
      return new Date(b.lastMsg.sent_at).getTime() - new Date(a.lastMsg.sent_at).getTime()
    })

  const filteredContacts = search
    ? contactsWithLastMsg.filter(c => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase()
        return name.includes(search.toLowerCase()) || c.phone?.includes(search) || c.email?.includes(search.toLowerCase())
      })
    : contactsWithLastMsg

  // Fetch thread when contact selected
  useEffect(() => {
    if (!selectedContactId) { setThreadMessages([]); return }

    async function fetchThread() {
      const { data } = await supabaseRef.current
        .from('comms_log')
        .select('*')
        .eq('contact_id', selectedContactId)
        .order('sent_at', { ascending: true })
        .limit(100)
      setThreadMessages((data ?? []) as unknown as Message[])
    }
    fetchThread()
  }, [selectedContactId])

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [threadMessages])

  // Realtime subscription
  useEffect(() => {
    if (!clientId) return
    const supabase = supabaseRef.current
    const channel = supabase
      .channel(`comms-${clientId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'comms_log',
        filter: `client_id=eq.${clientId}`,
      }, (payload) => {
        const newMsg = payload.new as unknown as Message
        if (newMsg.contact_id === selectedContactId) {
          setThreadMessages(prev => [...prev, newMsg])
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [clientId, selectedContactId])

  const selectedContact = contacts.find(c => c.id === selectedContactId)

  return (
    <div className="flex rounded-xl border overflow-hidden bg-card h-[calc(100%-60px)]" style={{ borderColor: 'var(--border)' }}>
      {/* Contact list (left) */}
      <div className={`w-full sm:w-80 sm:border-r flex-shrink-0 flex flex-col ${selectedContactId ? 'hidden sm:flex' : 'flex'}`} style={{ borderColor: 'var(--border)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-ring outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredContacts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">No contacts found</p>
          ) : (
            filteredContacts.map(c => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone || 'Unknown'
              const isSelected = selectedContactId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedContactId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b transition-colors touch-target ${
                    isSelected ? 'bg-brand-primary/10' : 'hover:bg-muted/50'
                  }`}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{name}</span>
                        {c.unread > 0 && (
                          <span className="flex items-center justify-center h-4 min-w-[16px] rounded-full bg-brand-primary px-1 text-[10px] font-bold text-white">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      {c.lastMsg?.body && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMsg.body.slice(0, 60)}</p>
                      )}
                    </div>
                    {c.lastMsg && (
                      <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(c.lastMsg.sent_at)}</span>
                        <span className={CHANNEL_COLORS[c.lastMsg.channel] ?? 'text-muted-foreground'}>
                          {CHANNEL_ICONS[c.lastMsg.channel]}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Thread (right) */}
      <div className={`flex-1 flex flex-col ${selectedContactId ? 'flex' : 'hidden sm:flex'}`}>
        {selectedContact ? (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <button
                onClick={() => setSelectedContactId(null)}
                className="sm:hidden text-muted-foreground"
                aria-label="Back to contacts"
              >
                ←
              </button>
              <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center text-xs font-bold text-brand-primary">
                {(selectedContact.first_name?.[0] ?? '?').toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {[selectedContact.first_name, selectedContact.last_name].filter(Boolean).join(' ') || 'Unknown'}
                </p>
                {selectedContact.company && (
                  <p className="text-xs text-muted-foreground">{selectedContact.company}</p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {threadMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
              ) : (
                threadMessages.map(msg => {
                  const isOutbound = msg.direction === 'outbound'
                  return (
                    <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        isOutbound
                          ? 'bg-brand-primary/10 text-foreground rounded-tr-sm'
                          : 'bg-muted text-foreground rounded-tl-sm'
                      }`}>
                        <p>{msg.body || '(empty message)'}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={CHANNEL_COLORS[msg.channel] ?? 'text-muted-foreground'}>
                            {CHANNEL_ICONS[msg.channel]}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{formatRelativeTime(msg.sent_at)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={threadEndRef} />
            </div>

            {/* Compose bar (disabled) */}
            <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                <MessageSquare size={14} />
                Compose will be enabled when messaging integration is active
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<MessageSquare size={24} />}
              title="Select a conversation"
              description="Choose a contact from the list to view their messages"
            />
          </div>
        )}
      </div>
    </div>
  )
}
