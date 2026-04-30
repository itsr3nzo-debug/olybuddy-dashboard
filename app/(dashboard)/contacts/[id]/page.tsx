import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { formatRelativeTime, formatDuration, formatDateTime, callerDisplayName } from '@/lib/format'
import { formatCurrency } from '@/lib/format'
import { STATUS_CONFIG, PIPELINE_STAGES } from '@/lib/constants'
import EmptyState from '@/components/shared/EmptyState'
import TranscriptBubbles from '@/components/shared/TranscriptBubbles'
import { Phone, Mail, Building2, Tag, Clock, MessageSquare, TrendingUp, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Contact | Nexley AI' }

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Validate UUID format before hitting the database
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const clientId = user.app_metadata?.client_id
  if (!clientId) redirect('/dashboard')

  // Parallel fetch all contact data
  const [contactRes, activitiesRes, callsRes, commsRes, oppsRes] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).eq('client_id', clientId).single(),
    supabase.from('activities').select('*').eq('contact_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('call_logs').select('*').eq('contact_id', id).order('started_at', { ascending: false }).limit(20),
    supabase.from('comms_log').select('*').eq('contact_id', id).order('sent_at', { ascending: false }).limit(20),
    supabase.from('opportunities').select('*').eq('contact_id', id),
  ])

  const contact = contactRes.data
  if (!contact) notFound()

  const activities = (activitiesRes.data ?? []) as Array<Record<string, unknown>>
  const calls = (callsRes.data ?? []) as Array<Record<string, unknown>>
  const comms = (commsRes.data ?? []) as Array<Record<string, unknown>>
  const opps = (oppsRes.data ?? []) as Array<Record<string, unknown>>

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown'
  const stageConfig = PIPELINE_STAGES.find(s => s.key === contact.pipeline_stage)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/calls" className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Back">
          <ArrowLeft size={18} className="text-muted-foreground" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{name}</h1>
          <div className="flex items-center gap-3 mt-1">
            {stageConfig && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${stageConfig.hex}15`, color: stageConfig.hex }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: stageConfig.hex }} />
                {stageConfig.label}
              </span>
            )}
            {contact.company && <span className="text-sm text-muted-foreground">{contact.company}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Contact info */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border p-5 bg-card space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Contact Info</h2>
            {contact.phone && (
              <div className="flex items-center gap-3">
                <Phone size={14} className="text-muted-foreground" />
                <a href={`tel:${contact.phone}`} className="text-sm text-brand-primary hover:underline">{contact.phone}</a>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-muted-foreground" />
                <a href={`mailto:${contact.email}`} className="text-sm text-brand-primary hover:underline">{contact.email}</a>
              </div>
            )}
            {contact.company && (
              <div className="flex items-center gap-3">
                <Building2 size={14} className="text-muted-foreground" />
                <span className="text-sm text-foreground">{contact.company}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Clock size={14} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Added {formatRelativeTime(contact.created_at)}</span>
            </div>
            {contact.tags && contact.tags.length > 0 && (
              <div className="flex items-start gap-3">
                <Tag size={14} className="text-muted-foreground mt-0.5" />
                <div className="flex flex-wrap gap-1">
                  {(contact.tags as string[]).map((tag: string) => (
                    <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Opportunities */}
          <div className="rounded-xl border p-5 bg-card">
            <h2 className="text-sm font-semibold text-foreground mb-3">Opportunities ({opps.length})</h2>
            {opps.length === 0 ? (
              <p className="text-xs text-muted-foreground">No opportunities yet</p>
            ) : (
              <div className="space-y-2">
                {opps.map((o) => (
                  <div key={o.id as string} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{o.title as string}</p>
                      <p className="text-xs text-muted-foreground">{o.stage as string}</p>
                    </div>
                    {(o.value_pence as number) > 0 && (
                      <span className="text-sm font-bold text-brand-success">{formatCurrency(o.value_pence as number)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — Activity feed */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border p-5 bg-card">
            <h2 className="text-sm font-semibold text-foreground mb-4">Activity Timeline</h2>

            {activities.length === 0 ? (
              <EmptyState title="No activity yet" description="Activity will appear here when calls, messages, or stage changes happen." />
            ) : (
              <div className="space-y-4">
                {activities.map((a) => {
                  const type = a.activity_type as string
                  const iconMap: Record<string, React.ReactNode> = {
                    call: <Phone size={12} />,
                    sms: <MessageSquare size={12} />,
                    email: <Mail size={12} />,
                    stage_change: <TrendingUp size={12} />,
                    note: <Tag size={12} />,
                  }
                  return (
                    <div key={a.id as string} className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        {iconMap[type] ?? <Clock size={12} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{a.description as string}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(a.created_at as string)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Calls */}
          {calls.length > 0 && (
            <div className="rounded-xl border p-5 bg-card mt-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Calls ({calls.length})</h2>
              <div className="space-y-3">
                {calls.slice(0, 5).map((c) => {
                  const sc = STATUS_CONFIG[c.status as string]
                  return (
                    <div key={c.id as string} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm text-foreground">{formatDuration(c.duration_seconds as number | null)} · {c.direction as string}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(c.started_at as string | null)}</p>
                      </div>
                      {sc && <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${sc.className}`}>{sc.label}</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Recent Messages */}
          {comms.length > 0 && (
            <div className="rounded-xl border p-5 bg-card mt-4">
              <h2 className="text-sm font-semibold text-foreground mb-3">Messages ({comms.length})</h2>
              <div className="space-y-3">
                {comms.slice(0, 5).map((m) => (
                  <div key={m.id as string} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{(m.body as string)?.slice(0, 80) || '(no content)'}</p>
                      <p className="text-xs text-muted-foreground">{m.channel as string} · {m.direction as string} · {formatRelativeTime(m.sent_at as string)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
