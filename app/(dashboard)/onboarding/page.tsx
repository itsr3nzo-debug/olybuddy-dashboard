'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plug, MessageSquare, ChevronRight, ChevronLeft, Check, Loader2 } from 'lucide-react'

const STEP_META = [
  { icon: Building2, label: 'Business Details' },
  { icon: Plug, label: 'Integrations' },
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

  const [error, setError] = useState('')

  async function saveStep(stepNum: number): Promise<boolean> {
    setSaving(true)
    setError('')
    const payloads: Record<number, object> = {
      1: { name, contact_name: contactName, phone, services_text: servicesText },
      2: {},
      3: { greeting_message: greeting },
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
    const saved = await saveStep(step)
    if (!saved) return
    if (step < 3) {
      setStep(step + 1)
    } else {
      router.replace('/dashboard')
    }
  }

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

        {/* Step 2: Integrations */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Plug size={20} className="text-brand-primary" />
                Connect Integrations
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Connect the tools your AI Employee will use. Skip any you don&apos;t need yet.</p>
            </div>
            <div className="grid gap-2.5">
              {[
                { id: 'gmail', name: 'Gmail', blurb: 'Read and send emails', color: 'bg-red-900/20 text-red-400' },
                { id: 'google_calendar', name: 'Google Calendar', blurb: 'Auto-book appointments', color: 'bg-blue-900/20 text-blue-400' },
                { id: 'quickbooks', name: 'QuickBooks', blurb: 'Invoices and accounting', color: 'bg-emerald-900/20 text-emerald-400' },
                { id: 'hubspot', name: 'HubSpot', blurb: 'CRM and pipeline', color: 'bg-orange-900/20 text-orange-400' },
                { id: 'slack', name: 'Slack', blurb: 'Team notifications', color: 'bg-purple-900/20 text-purple-400' },
                { id: 'calendly', name: 'Calendly', blurb: 'Client booking links', color: 'bg-sky-900/20 text-sky-400' },
              ].map((p) => (
                <a key={p.id} href={`/api/oauth/${p.id}`}
                  className="flex items-center gap-3 p-3.5 bg-background border rounded-lg hover:border-brand-primary/50 transition-colors group">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${p.color}`}>
                    <Plug size={16} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium group-hover:text-brand-primary transition-colors">Connect {p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.blurb}</p>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: AI Greeting */}
        {step === 3 && (
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
          <button onClick={handleNext} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {step === 3 ? 'Finish Setup' : step === 2 ? 'Skip for now' : 'Continue'}
            {step < 3 && !saving && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
