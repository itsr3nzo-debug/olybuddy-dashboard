'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, Plug, MessageSquare, ChevronRight, ChevronLeft, Check, Loader2, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { PROVIDERS, CATEGORIES } from '@/lib/integrations-config'
import ProviderIcon from '@/components/integrations/ProviderIcon'

const STEP_META = [
  { icon: Building2, label: 'Business Details' },
  { icon: Plug, label: 'Integrations' },
  { icon: Shield, label: 'Terms & DPA' },
  { icon: MessageSquare, label: 'AI Greeting' },
]

interface OnboardingData {
  name: string
  contact_name: string
  phone: string
  services_text: string
  greeting_message: string
  onboarding_step: number
  onboarding_completed?: boolean
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [servicesText, setServicesText] = useState('')
  const [greeting, setGreeting] = useState('')
  const [dpaAccepted, setDpaAccepted] = useState(false)
  const [connectedCount, setConnectedCount] = useState(0)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')

  useEffect(() => {
    fetch('/api/onboarding')
      .then(r => {
        if (!r.ok) throw new Error('No client data')
        return r.json()
      })
      .then((data: OnboardingData) => {
        if (data.onboarding_completed || (data as OnboardingData & { error?: string }).error) {
          router.replace('/dashboard')
          return
        }
        setName(data.name ?? '')
        setContactName(data.contact_name ?? '')
        setPhone(data.phone ?? '')
        setServicesText(data.services_text ?? '')
        setGreeting(data.greeting_message ?? `Hey, thanks for reaching out to ${data.name || 'us'}! How can I help you today?`)
        setLoading(false)
      })
      .catch(() => router.replace('/dashboard'))
  }, [router])

  // Live-poll connected integration count so the user sees the counter rise
  // without leaving the page while the OAuth dance happens in another tab.
  useEffect(() => {
    if (step !== 2) return
    let mounted = true
    const supabase = createClient()
    async function check() {
      const { count } = await supabase.from('integrations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'connected')
      if (mounted && count !== null) setConnectedCount(count)
    }
    check()
    const id = setInterval(check, 4000)
    return () => { mounted = false; clearInterval(id) }
  }, [step])

  const [error, setError] = useState('')

  async function saveStep(stepNum: number): Promise<boolean> {
    setSaving(true)
    setError('')
    const payloads: Record<number, object> = {
      1: { name, contact_name: contactName, phone, services_text: servicesText },
      2: {},
      3: { dpa_accepted_at: new Date().toISOString() },
      4: { greeting_message: greeting },
    }
    try {
      const res = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepNum, data: payloads[stepNum] }),
      })
      if (!res.ok) {
        setError('Failed to save. Please try again.')
        return false
      }
      return true
    } catch {
      setError('Network error. Please check your connection.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleNext() {
    // Validation per step (integrations step is optional — skip allowed)
    if (step === 3 && !dpaAccepted) {
      setError('Please accept the Data Processing Agreement to continue.')
      return
    }
    const saved = await saveStep(step)
    if (!saved) return
    if (step < 4) {
      setStep(step + 1)
    } else {
      router.replace('/dashboard')
    }
  }

  // 6 prioritized integrations shown by default, rest behind "Show all"
  const onboardingProviders = PROVIDERS.filter(p => p.available)
  const filteredProviders = onboardingProviders.filter(p => {
    if (activeCategory !== 'all' && p.category !== activeCategory) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.description?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const PRIORITY_IDS = ['gmail', 'google_calendar', 'outlook', 'quickbooks', 'hubspot', 'slack']
  const priorityProviders = filteredProviders.filter(p => PRIORITY_IDS.includes(p.id))
  const otherProviders = filteredProviders.filter(p => !PRIORITY_IDS.includes(p.id))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold mb-1">Welcome to Nexley AI</h1>
        <p className="text-muted-foreground">Let&apos;s get your AI Employee set up.</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-10">
        {STEP_META.map((s, i) => {
          const StepIcon = s.icon
          const stepNum = i + 1
          const isActive = stepNum === step
          const isDone = stepNum < step
          return (
            <div key={s.label} className="flex-1 flex flex-col items-center gap-1.5">
              <div className={`w-full h-1.5 rounded-full transition-colors ${
                isDone ? 'bg-green-500' : isActive ? 'bg-brand-primary' : 'bg-muted'
              }`} />
              <div className="flex items-center gap-1.5">
                {isDone ? (
                  <Check size={14} className="text-green-500" />
                ) : (
                  <StepIcon size={14} className={isActive ? 'text-brand-primary' : 'text-muted-foreground'} />
                )}
                <span className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-card rounded-xl border p-6 sm:p-8">
        {/* Step 1: Business Details */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Building2 size={20} className="text-brand-primary" />
                Confirm Your Business Details
              </h2>
              <p className="text-sm text-muted-foreground mt-1">We pre-filled what we know. Update anything that looks off.</p>
            </div>
            <div className="grid gap-4">
              <label className="block">
                <span className="text-sm font-medium mb-1 block">Business Name</span>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50" />
              </label>
              <label className="block">
                <span className="text-sm font-medium mb-1 block">Contact Name</span>
                <input type="text" value={contactName} onChange={e => setContactName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50" />
              </label>
              <label className="block">
                <span className="text-sm font-medium mb-1 block">Phone Number</span>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 900000"
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50" />
              </label>
              <label className="block">
                <span className="text-sm font-medium mb-1 block">Services You Offer</span>
                <textarea value={servicesText} onChange={e => setServicesText(e.target.value)} rows={3}
                  placeholder="e.g. Boiler repair, Bathroom install, Emergency callout"
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 resize-none" />
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Integrations — all 118 with search + categories, optional */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Plug size={20} className="text-brand-primary" />
                Connect integrations <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Pick the apps you actually use — or skip and add them later from Settings.
                {connectedCount > 0 && <span className="text-emerald-400"> · ✅ {connectedCount} connected</span>}
              </p>
            </div>

            <input
              type="search"
              placeholder="Search 100+ integrations: Notion, Pipedrive, Dropbox, Salesforce…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
            />

            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.slice(0, 12).map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-brand-primary text-white border-brand-primary'
                      : 'bg-background border-muted text-muted-foreground hover:border-brand-primary/30'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 max-h-[420px] overflow-y-auto pr-1">
              {priorityProviders.length > 0 && !search && activeCategory === 'all' && (
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2 mb-1">Most popular</p>
              )}
              {priorityProviders.map((p) => (
                <a key={p.id} href={`/api/oauth/${p.id}`}
                  className="flex items-center gap-3 p-3 bg-background border rounded-lg hover:border-brand-primary/50 transition-colors group">
                  <ProviderIcon provider={p} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-brand-primary transition-colors">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </a>
              ))}
              {otherProviders.length > 0 && (
                <>
                  {priorityProviders.length > 0 && !search && activeCategory === 'all' && (
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-3 mb-1">Everything else ({otherProviders.length})</p>
                  )}
                  {otherProviders.map((p) => (
                    <a key={p.id} href={`/api/oauth/${p.id}`}
                      className="flex items-center gap-3 p-3 bg-background border rounded-lg hover:border-brand-primary/50 transition-colors group">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.iconColor}`}>
                        <Plug size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-brand-primary transition-colors">{p.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </a>
                  ))}
                </>
              )}
              {filteredProviders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No matches. Try a different search.</p>
              )}
            </div>
          </div>
        )}

        {/* Step 3: DPA */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Shield size={20} className="text-brand-primary" />
                Data Processing Agreement
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Required by UK GDPR. Nexley AI processes data on your instruction —
                this DPA documents the security measures, sub-processors, and your rights.
              </p>
            </div>
            <div className="bg-background border rounded-lg p-4 space-y-2 text-sm">
              <p className="font-medium">By accepting, you confirm:</p>
              <ul className="text-muted-foreground space-y-1 ml-5 list-disc">
                <li>You are an authorised representative of {name || 'your business'}</li>
                <li>You&apos;ve reviewed our <Link href="/security" target="_blank" className="text-brand-primary hover:underline">security posture</Link> and the <Link href="/legal/DPA-template.md" target="_blank" className="text-brand-primary hover:underline">full DPA</Link></li>
                <li>Sub-processors (Supabase, Composio, Vercel, Hetzner, Anthropic) are accepted</li>
                <li>You can request a counter-signed copy at <a href="mailto:legal@nexley.ai" className="text-brand-primary hover:underline">legal@nexley.ai</a></li>
              </ul>
            </div>
            <label className="flex items-start gap-3 p-3 bg-background border rounded-lg cursor-pointer hover:border-brand-primary/50">
              <input
                type="checkbox"
                checked={dpaAccepted}
                onChange={e => setDpaAccepted(e.target.checked)}
                className="mt-0.5 accent-brand-primary"
              />
              <span className="text-sm">I accept the Nexley AI Data Processing Agreement</span>
            </label>
          </div>
        )}

        {/* Step 4: AI Greeting */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <MessageSquare size={20} className="text-brand-primary" />
                Review Your AI Greeting
              </h2>
              <p className="text-sm text-muted-foreground mt-1">This is what customers see when your AI Employee responds.</p>
            </div>
            <label className="block">
              <span className="text-sm font-medium mb-1 block">Greeting Message</span>
              <textarea value={greeting} onChange={e => setGreeting(e.target.value)} rows={4}
                className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 resize-none" />
            </label>
            <div className="bg-background border rounded-lg p-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Customer sees:</p>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-primary/20 flex items-center justify-center shrink-0">
                  <MessageSquare size={14} className="text-brand-primary" />
                </div>
                <p className="text-sm leading-relaxed">{greeting || 'No greeting set'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft size={16} /> Back
            </button>
          ) : <div />}
          <button onClick={handleNext} disabled={saving || (step === 3 && !dpaAccepted)}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {step === 4 ? 'Finish Setup' : 'Continue'}
            {step < 4 && !saving && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
