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

const STEP_LABELS = ['Get Started', 'Your Business', "AI Personality", 'Choose Plan']

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
    business_name: '',
    contact_name: '',
    phone: '',
    location: '',
    industry: '',
    services: '',
    personality: 'friendly',
    plan: 'trial',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(cancelled ? 'Payment was cancelled. Try again or choose a different plan.' : '')
  const [success, setSuccess] = useState(false)

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  function canProceed(): boolean {
    if (step === 1) return !!form.email && form.email.includes('@')
    if (step === 2) return !!form.business_name && !!form.industry
    if (step === 3) return !!form.personality
    if (step === 4) return !!form.plan
    return false
  }

  function next() {
    if (canProceed() && step < 4) setStep(step + 1)
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
        body: JSON.stringify(form),
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
        setSuccess(true)
        setLoading(false)
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
          <h1 className="text-3xl font-bold text-white mb-3">Check your email!</h1>
          <p className="text-slate-400 mb-6">
            We&apos;ve sent a magic link to <span className="text-white font-medium">{form.email}</span>.
            Click it to access your dashboard and meet your AI Employee.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="text-indigo-400 hover:text-indigo-300 text-sm font-medium"
          >
            Go to sign in
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
              {i < 3 && <div className={`w-8 h-px ${i + 1 < step ? 'bg-green-500/30' : 'bg-white/10'}`} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
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
                        onKeyDown={e => e.key === 'Enter' && canProceed() && next()}
                      />
                    </div>
                  </div>
                </div>

                {/* Social proof */}
                <p className="text-center text-xs text-slate-500 mt-6">
                  Trusted by UK service businesses. No credit card required for trial.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="max-w-2xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  What&apos;s your trade?
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
                          placeholder="e.g. Smith's Plumbing"
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
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  Choose your AI&apos;s personality
                </h2>
                <p className="text-slate-400 text-center mb-6">
                  How should your AI Employee talk to customers?
                </p>

                <div className="grid lg:grid-cols-2 gap-8 items-start">
                  {/* Personality cards */}
                  <div>
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
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="max-w-3xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  Choose your plan
                </h2>
                <p className="text-slate-400 text-center mb-6">
                  Start with a trial or go straight to a monthly plan.
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

          {step < 4 ? (
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
                <>Start 5-day trial<ArrowRight size={16} /></>
              ) : (
                <>Continue to payment<ArrowRight size={16} /></>
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
