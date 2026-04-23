'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Mail,
  Building2,
  User,
  Phone,
  MapPin,
  Check,
} from 'lucide-react'
import IndustryPicker from '@/components/signup/IndustryPicker'
import PersonalityPicker from '@/components/signup/PersonalityPicker'
import WhatsAppPreview from '@/components/signup/WhatsAppPreview'
import PlanCards from '@/components/signup/PlanCards'
import PhoneNumbersStep, { phoneNumbersStepValid } from '@/components/signup/PhoneNumbersStep'
import { createClient } from '@/lib/supabase/client'

const STEP_LABELS = ['Get Started', 'Your Business', 'WhatsApp Setup', "AI Personality", 'Choose Plan']
const TOTAL_STEPS = 5

export default function SignupPage() {
  return (
    <Suspense>
      <SignupWizard />
    </Suspense>
  )
}

function SignupWizard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const cancelled = searchParams.get('cancelled')

  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    email: '',
    password: '',
    business_name: '',
    contact_name: '',
    phone: '',
    location: '',
    industry: '',
    services: '',
    personality: 'optimistic',
    agent_name: 'Nexley',
    plan: 'trial',
    business_whatsapp: '',
    owner_phone: '',
    owner_name: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(cancelled ? 'Payment was cancelled. Try again or choose a different plan.' : '')
  const [success, setSuccess] = useState(false)

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  // Per-industry hints so the Business name and Services placeholders match
  // whatever industry the user picked in step 2 (used to always say "Plumbing").
  const INDUSTRY_HINTS: Record<string, { biz: string; services: string }> = {
    accountant: { biz: "e.g. Smith & Co Accountants", services: 'e.g. Self-assessment, VAT returns, Bookkeeping' },
    solicitor: { biz: 'e.g. Smith Legal', services: 'e.g. Conveyancing, Wills, Employment law' },
    plumber: { biz: "e.g. Smith's Plumbing", services: 'e.g. Boiler repair, Bathroom install, Emergency callout' },
    electrician: { biz: "e.g. Smith Electrical", services: 'e.g. EICR certificates, Fuse box upgrades, Emergency callout' },
    builder: { biz: "e.g. Smith Builders", services: 'e.g. Extensions, Loft conversions, Renovations' },
    landscaper: { biz: "e.g. Smith Landscapes", services: 'e.g. Lawn care, Fencing, Garden design' },
    roofer: { biz: "e.g. Smith Roofing", services: 'e.g. Roof repairs, Re-roofs, Gutter cleaning' },
    cleaner: { biz: "e.g. Smith Cleaning Co", services: 'e.g. End of tenancy, Office cleaning, Deep clean' },
  }
  const industryKey = (form.industry || '').toLowerCase()
  const hints = INDUSTRY_HINTS[industryKey] || { biz: 'e.g. Your Business Ltd', services: 'e.g. Your core services' }

  function canProceed(): boolean {
    if (step === 1) return !!form.email && form.email.includes('@') && !!form.password && form.password.length >= 10 && /\d/.test(form.password)
    if (step === 2) return !!form.business_name && !!form.industry
    if (step === 3) return phoneNumbersStepValid(form.business_whatsapp, form.owner_phone)
    if (step === 4) return !!form.personality && !!form.agent_name.trim() && form.agent_name.trim().length <= 30
    if (step === 5) return !!form.plan
    return false
  }

  function next() {
    if (canProceed() && step < TOTAL_STEPS) setStep(step + 1)
  }

  function back() {
    if (step > 1) setStep(step - 1)
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          owner_name: form.owner_name || form.contact_name,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return
      }

      if (data.success) {
        // Auto-sign-in with the password they just set so they land straight
        // in /dashboard instead of being bounced to /login
        const supabase = createClient()
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })
        if (signInErr) {
          // Fall back to "You're in" screen with a link to /login
          setSuccess(true)
          setLoading(false)
          return
        }
        // Session cookie set — go straight to onboarding (new users) or dashboard
        router.replace('/onboarding')
      }
    } catch {
      setError('Network error. Please check your connection.')
      setLoading(false)
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.2 }}
            className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6"
          >
            <Check size={40} className="text-green-400" />
          </motion.div>
          <h1 className="text-3xl font-bold text-white mb-3">You&apos;re in!</h1>
          <p className="text-slate-400 mb-6">
            Account created for <span className="text-white font-medium">{form.email}</span>.
            Sign in with the password you just chose to meet your AI Employee.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-lg text-sm"
          >
            Sign in now →
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-indigo-500/5 rounded-full blur-[120px]" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold text-white">Nexley AI</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                i + 1 < step ? 'bg-green-500/20 text-green-400' :
                i + 1 === step ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30' :
                'bg-white/5 text-slate-500'
              }`}>
                {i + 1 < step ? <Check size={12} /> : <span>{i + 1}</span>}
                <span className="hidden sm:inline">{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && <div className={`w-8 h-px ${i + 1 < step ? 'bg-green-500/30' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.12 }}
          >
            {step === 1 && (
              <div className="max-w-md mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  Get your AI Employee
                </h2>
                <p className="text-slate-400 text-center mb-8">
                  An AI that answers your phone, responds on WhatsApp, books jobs, and follows up — 24/7.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="email"
                        value={form.email}
                        onChange={e => update('email', e.target.value)}
                        placeholder="you@business.co.uk"
                        autoFocus
                        className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => update('password', e.target.value)}
                      placeholder="Minimum 10 characters, include a number"
                      minLength={10}
                      autoComplete="new-password"
                      className="w-full px-4 py-3.5 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                      onKeyDown={e => e.key === 'Enter' && canProceed() && next()}
                    />
                    {form.password && form.password.length < 10 && (
                      <p className="text-xs text-amber-400 mt-1.5">{10 - form.password.length} more character{10 - form.password.length === 1 ? '' : 's'} needed</p>
                    )}
                    {form.password && form.password.length >= 10 && !/\d/.test(form.password) && (
                      <p className="text-xs text-amber-400 mt-1.5">Add at least one number</p>
                    )}
                  </div>
                </div>

                {/* Social proof */}
                <p className="text-center text-xs text-slate-500 mt-6">
                  Trusted by UK service businesses. £20 today unlocks a 5-day trial — then £599/mo from Day 6. Cancel anytime during the trial.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="max-w-2xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  What&apos;s your industry?
                </h2>
                <p className="text-slate-400 text-center mb-6">
                  We&apos;ll customise your AI Employee with industry-specific knowledge.
                </p>

                <IndustryPicker selected={form.industry} onSelect={v => update('industry', v)} />

                {form.industry && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 space-y-3 max-w-md mx-auto"
                  >
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">Business name</label>
                      <div className="relative">
                        <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={form.business_name}
                          onChange={e => update('business_name', e.target.value)}
                          placeholder={hints.biz}
                          autoFocus
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Your name</label>
                        <div className="relative">
                          <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input
                            type="text"
                            value={form.contact_name}
                            onChange={e => update('contact_name', e.target.value)}
                            placeholder="Dave Smith"
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Location</label>
                        <div className="relative">
                          <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input
                            type="text"
                            value={form.location}
                            onChange={e => update('location', e.target.value)}
                            placeholder="Manchester"
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="max-w-xl mx-auto text-slate-200">
                <PhoneNumbersStep
                  businessWhatsapp={form.business_whatsapp}
                  ownerPhone={form.owner_phone}
                  ownerName={form.owner_name || form.contact_name}
                  onChange={(field, value) => update(field, value)}
                />
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  Choose your AI&apos;s personality
                </h2>
                <p className="text-slate-400 text-center mb-6">
                  How should your AI Employee talk to customers?
                </p>

                <div className="grid lg:grid-cols-2 gap-8 items-start">
                  {/* Personality cards + name */}
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-white mb-2">
                        What should your AI employee be called?
                      </label>
                      <p className="text-xs text-slate-400 mb-3">
                        This is the name customers see on WhatsApp. Pick a first name that feels right
                        for your business — &ldquo;Nexley&rdquo; (branded) or anything human like &ldquo;Aiden&rdquo;, &ldquo;Sarah&rdquo;, &ldquo;Charlie&rdquo;.
                        You can change it later in settings.
                      </p>
                      <input
                        type="text"
                        value={form.agent_name}
                        onChange={e => update('agent_name', e.target.value.slice(0, 30))}
                        maxLength={30}
                        placeholder="Nexley"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                        aria-label="AI employee name"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        {form.agent_name.trim().length === 0
                          ? 'Required'
                          : `${form.agent_name.trim().length}/30`}
                      </p>
                    </div>

                    <PersonalityPicker
                      selected={form.personality}
                      onSelect={v => update('personality', v)}
                      industry={form.industry}
                    />
                  </div>

                  {/* Live WhatsApp preview */}
                  <div className="flex justify-center lg:sticky lg:top-8">
                    <div>
                      <p className="text-xs text-slate-500 text-center mb-3">Live preview</p>
                      <WhatsAppPreview
                        industry={form.industry || 'plumber'}
                        personality={form.personality}
                        agentName={form.agent_name.trim() || 'Nexley'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="max-w-5xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  Hire your AI Employee
                </h2>
                <p className="text-slate-400 text-center mb-8">
                  No long contracts. Cancel anytime.
                </p>

                <PlanCards
                  selected={form.plan}
                  onSelect={v => update('plan', v)}
                  industry={form.industry}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-red-400 text-sm text-center mt-4"
          >
            {error}
          </motion.p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-center gap-3 mt-8">
          {step > 1 && (
            <button
              onClick={back}
              className="flex items-center gap-2 px-5 py-3 rounded-xl border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/5 transition-all"
            >
              <ArrowLeft size={16} />
              Back
            </button>
          )}

          {step < TOTAL_STEPS ? (
            <button
              onClick={next}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25"
            >
              Continue
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading || !canProceed()}
              className="flex items-center gap-2 px-8 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25"
            >
              {loading ? (
                'Processing...'
              ) : form.plan === 'trial' ? (
                <>Try Nexley AI — 5 days<ArrowRight size={16} /></>
              ) : form.plan === 'voice' ? (
                <>Hire AI Employee + Voice<ArrowRight size={16} /></>
              ) : (
                <>Hire your AI Employee<ArrowRight size={16} /></>
              )}
            </button>
          )}
        </div>

        {/* Sign in link */}
        <p className="text-center text-sm text-slate-500 mt-6">
          Already have an account?{' '}
          <button onClick={() => router.push('/login')} className="text-indigo-400 hover:text-indigo-300 font-medium">
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
