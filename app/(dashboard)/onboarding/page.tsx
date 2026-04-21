'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, MessageSquare, ChevronLeft, Check, Loader2, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const STEP_META = [
  { icon: Building2, label: 'Business Details' },
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
  industry?: string
}

const SERVICES_HINT_BY_INDUSTRY: Record<string, string> = {
  accountant: 'e.g. Self-assessment, VAT returns, Bookkeeping',
  solicitor: 'e.g. Conveyancing, Wills, Employment law',
  plumber: 'e.g. Boiler repair, Bathroom install, Emergency callout',
  electrician: 'e.g. EICR certificates, Fuse box upgrades, Emergency callout',
  builder: 'e.g. Extensions, Loft conversions, Renovations',
  landscaper: 'e.g. Lawn care, Fencing, Garden design',
  roofer: 'e.g. Roof repairs, Re-roofs, Gutter cleaning',
  cleaner: 'e.g. End of tenancy, Office cleaning, Deep clean',
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
  const [industry, setIndustry] = useState('')
  const [greeting, setGreeting] = useState('')
  const [dpaAccepted, setDpaAccepted] = useState(false)
  const [connectedCount, setConnectedCount] = useState(0)

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
        setIndustry((data.industry ?? '').toLowerCase())
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
    // Frontend has 3 steps but API still uses 4-step numbering (step 2 = integrations was removed from UI).
    // Map: frontend 1 → API 1, frontend 2 → API 3, frontend 3 → API 4
    const API_STEP_MAP: Record<number, number> = { 1: 1, 2: 3, 3: 4 }
    const apiStep = API_STEP_MAP[stepNum] ?? stepNum
    const payloads: Record<number, object> = {
      1: { name, contact_name: contactName, phone, services_text: servicesText },
      3: { dpa_accepted_at: new Date().toISOString() },
      4: { greeting_message: greeting },
    }
    try {
      // If saving step 1 (business details), also silently advance past the removed
      // integrations step (API step 2) so the backend stays in sync.
      if (apiStep === 1) {
        const r1 = await fetch('/api/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 1, data: payloads[1] }),
        })
        if (!r1.ok) { setError('Failed to save. Please try again.'); return false }
        // Skip integrations step silently
        await fetch('/api/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 2, data: {} }),
        })
        return true
      }
      const res = await fetch('/api/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: apiStep, data: payloads[apiStep] }),
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
    // Validation per step (3 steps: Business Details, DPA, AI Greeting)
    if (step === 2 && !dpaAccepted) {
      setError('Please accept the Data Processing Agreement to continue.')
      return
    }
    const saved = await saveStep(step)
    if (!saved) return
    if (step < 3) {
      setStep(step + 1)
    } else {
      // Step 1: refresh the Supabase session so the JWT picks up the freshly-
      // written `app_metadata.onboarding_completed = true` stamp. Without this,
      // the proxy's fast-path keeps seeing the old `false` claim on the next
      // navigation and the DB fallback does the right thing, but it's an
      // extra DB round-trip per request until the session expires (~1h).
      try {
        const sb = createClient()
        await sb.auth.refreshSession()
      } catch {
        // non-fatal — proxy will DB-fall-back and user experience is unchanged
      }
      // Step 2: bust Next.js's Router Cache so the next RSC fetch for
      // /dashboard reads fresh state (layout data, sidebar, banners).
      router.refresh()
      // Tiny delay lets the refresh settle before we navigate
      await new Promise(r => setTimeout(r, 100))
      router.replace('/dashboard')
    }
  }

  // 6 prioritized integrations shown by default, rest behind "Show all"
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
                  placeholder={SERVICES_HINT_BY_INDUSTRY[industry] || 'e.g. Your core services'}
                  className="w-full px-3 py-2 bg-background border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 resize-none" />
              </label>
            </div>
          </div>
        )}

        {/* Step 2: DPA (was step 3 — integrations removed from onboarding) */}
        {step === 2 && (
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
                <li>You accept our listed sub-processors (database, hosting, integration and model providers). Full list at <a href="https://nexley.ai/legal/sub-processors" className="underline hover:text-white" target="_blank" rel="noreferrer">nexley.ai/legal/sub-processors</a></li>
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
          <button onClick={handleNext} disabled={saving || (step === 2 && !dpaAccepted)}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {step === 3 ? 'Finish Setup' : 'Continue'}
            {step < 3 && !saving && <ChevronLeft size={16} className="rotate-180" />}
          </button>
        </div>
      </div>
    </div>
  )
}
