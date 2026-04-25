'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Mail,
  Building2,
  User,
  MapPin,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react'
import IndustryPicker from '@/components/signup/IndustryPicker'
import PersonalityPicker from '@/components/signup/PersonalityPicker'
import WhatsAppPreview from '@/components/signup/WhatsAppPreview'
import PlanCards from '@/components/signup/PlanCards'
import PhoneNumbersStep, { phoneNumbersStepValid } from '@/components/signup/PhoneNumbersStep'
import { createClient } from '@/lib/supabase/client'
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

const STEP_LABELS = ['Get Started', 'Your Business', 'WhatsApp Setup', "AI Personality", 'Choose Plan']
const TOTAL_STEPS = 5
// localStorage key for form state. Bump suffix when adding new required fields
// to invalidate stale drafts that would fail validation.
const DRAFT_KEY = 'nexley:signup-draft:v2'

const EMPTY_FORM = {
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
}

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
  // Item #14 — referral attribution. ?ref=<code> in the URL means someone
  // shared their referral link. We persist the code to localStorage so it
  // survives navigations within the wizard, and forward it to /api/signup
  // on submit. The server validates + de-dupes (each referee can only be
  // referred once).
  const refParam = searchParams.get('ref')

  const [step, setStep] = useState(1)
  const [form, setForm] = useState(EMPTY_FORM)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [referralValid, setReferralValid] = useState<boolean | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(cancelled ? 'Payment was cancelled. Try again or choose a different plan.' : '')
  const [success, setSuccess] = useState(false)
  // Devil's-advocate fix P2 #18: when we restore a partial draft, dropping
  // the user back at step 1 with all OTHER data preserved is confusing
  // — they can't tell that step 2-5 progress is intact until they click
  // through. Track whether we restored from a draft so step 1 can show
  // a "Welcome back — resuming from step N" banner.
  const [resumedFromStep, setResumedFromStep] = useState<number | null>(null)

  // Capture ?ref= on first render and persist to localStorage. Multi-step
  // wizards drop search params on internal navigation, so we cache it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem('nexley:ref') || null
    const incoming = (refParam || '').trim().toLowerCase() || null
    const code = incoming || stored
    if (incoming) window.localStorage.setItem('nexley:ref', incoming)
    setReferralCode(code)
    if (code) {
      // Best-effort validation — show the user that the code's recognised.
      // Doesn't block signup if the API is down.
      fetch(`/api/referrals/validate?code=${encodeURIComponent(code)}`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { valid: false })
        .then(d => setReferralValid(!!d.valid))
        .catch(() => setReferralValid(null))
    }
  }, [refParam])

  // Restore in-flight signup state from localStorage. Runs once on mount.
  // Password is intentionally NEVER persisted (we'd be writing a plaintext
  // password to localStorage — XSS risk dwarfs the convenience win). The
  // user re-enters it once when they land on Step 1 of a resumed draft.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      const raw = window.localStorage.getItem(DRAFT_KEY)
      if (!raw) { setHydrated(true); return }
      const draft = JSON.parse(raw) as { form?: Partial<typeof EMPTY_FORM>; step?: number; savedAt?: number }
      // Drop drafts older than 7 days — pricing/copy may have moved on.
      if (draft.savedAt && Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
        window.localStorage.removeItem(DRAFT_KEY)
        setHydrated(true)
        return
      }
      if (draft.form) {
        // Strip password defensively — never persisted, but be paranoid.
        const safe = { ...EMPTY_FORM, ...draft.form, password: '' }
        setForm(safe as typeof EMPTY_FORM)
      }
      if (draft.step && draft.step >= 1 && draft.step <= TOTAL_STEPS) {
        // If they had a partial draft past step 1, drop them back at step 1
        // so they can re-enter password before continuing. Track the
        // original progress step so the welcome-back banner can tell them
        // their step 2-5 data is preserved.
        if (draft.step > 1) setResumedFromStep(draft.step)
        setStep(draft.step > 1 ? 1 : draft.step)
      }
    } catch { /* corrupted draft — ignore */ }
    setHydrated(true)
  }, [])

  // Persist on every form/step change, debounced via the React batch model
  // (each setForm replaces the draft). Skips password so plaintext doesn't
  // hit storage even briefly. Skips persistence until hydration completes
  // so we don't overwrite an existing draft with the empty initial state.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return
    try {
      const { password: _pw, ...persistable } = form
      void _pw
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        form: persistable,
        step,
        savedAt: Date.now(),
      }))
    } catch { /* quota exceeded — silent */ }
  }, [form, step, hydrated])

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

  // Live password strength — same rules the server enforces. Recomputes on
  // every keystroke so the rule checklist updates in real time.
  const passwordCheck = validatePassword(form.password, {
    email: form.email,
    businessName: form.business_name,
  })

  function canProceed(): boolean {
    if (step === 1) return !!form.email && form.email.includes('@') && !!form.password && passwordCheck.error === null
    if (step === 2) return !!form.business_name && !!form.industry
    if (step === 3) return phoneNumbersStepValid(form.business_whatsapp, form.owner_phone)
    if (step === 4) return !!form.personality && !!form.agent_name.trim() && form.agent_name.trim().length <= 30
    if (step === 5) return !!form.plan
    return false
  }

  function next() {
    if (!canProceed() || step >= TOTAL_STEPS) return
    // Devil's-advocate fix round 2: when we restored a draft past step 1
    // and the user just re-entered their password (advancing from step 1),
    // jump straight to where they left off. The banner promised "we'll
    // skip you to step N" — fulfil that promise instead of advancing
    // one step at a time.
    if (step === 1 && resumedFromStep && resumedFromStep > 2) {
      setStep(resumedFromStep)
      setResumedFromStep(null)  // one-shot: don't keep skipping
      return
    }
    setStep(step + 1)
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
          // Item #14 — forward the referral code if we captured one earlier.
          referral_code: referralCode,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      if (data.checkoutUrl) {
        // Account created successfully — wipe the draft so a refresh of /signup
        // doesn't restore a half-completed flow over the new account.
        try { window.localStorage.removeItem(DRAFT_KEY); window.localStorage.removeItem('nexley:ref') } catch { /* quota */ }
        // Sign in BEFORE redirecting to Stripe. Supabase sets a session cookie
        // that survives the round-trip to Stripe Checkout, so when the customer
        // returns to /signup/success they're already authenticated — no manual
        // "Sign in to your dashboard" step needed. Makes the whole signup →
        // payment → dashboard flow single-click after they enter their card.
        const supabase = createClient()
        try {
          await supabase.auth.signInWithPassword({
            email: form.email,
            password: form.password,
          })
        } catch {
          // Non-fatal — they can still sign in manually from /signup/success
          // if this silent pre-auth fails for any reason.
        }
        window.location.href = data.checkoutUrl
        return
      }

      if (data.success) {
        try { window.localStorage.removeItem(DRAFT_KEY); window.localStorage.removeItem('nexley:ref') } catch { /* quota */ }
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
                <p className="text-slate-400 text-center mb-4">
                  An AI that answers your phone, responds on WhatsApp, books jobs, and follows up — 24/7.
                </p>

                {/* Welcome-back banner (P2 #18) — when we restored a draft past
                    step 1, tell the user their progress is preserved so
                    they don't think the form lost everything. */}
                {resumedFromStep && step === 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 mx-auto max-w-md rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3"
                  >
                    <p className="text-xs text-indigo-200">
                      <span className="font-medium text-indigo-100">Welcome back.</span> Re-enter your password and we&apos;ll skip you straight to step {resumedFromStep} — your business details, WhatsApp numbers and personality are all saved.
                    </p>
                  </motion.div>
                )}

                {/* Referral acknowledgement (item #14) — only shows if the URL had ?ref= and we validated it */}
                {referralCode && referralValid && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 mx-auto max-w-sm rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-center"
                  >
                    <p className="text-xs text-emerald-200">
                      Referred via <span className="font-mono text-emerald-300">{referralCode}</span>. Your referrer earns £150 off when you become a paying customer.
                    </p>
                  </motion.div>
                )}

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
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={form.password}
                        onChange={e => update('password', e.target.value)}
                        placeholder={`At least ${PASSWORD_MIN_LENGTH} characters with a mix`}
                        minLength={PASSWORD_MIN_LENGTH}
                        autoComplete="new-password"
                        className="w-full pr-11 px-4 py-3.5 rounded-xl border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all bg-white/5 text-white placeholder:text-slate-500"
                        onKeyDown={e => e.key === 'Enter' && canProceed() && next()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-200 transition"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {form.password.length > 0 && (
                      <PasswordStrengthMeter check={passwordCheck} />
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="max-w-3xl mx-auto">
                <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">
                  You&apos;re one click from your AI Employee
                </h2>
                <p className="text-slate-400 text-center mb-8">
                  Review the offer below, then hit &quot;Start my 5-day trial&quot; to pay £20 and get started.
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
                <>Redirecting to Stripe…</>
              ) : (
                <>Start my 5-day trial — £20<ArrowRight size={16} /></>
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

/**
 * Live password-strength feedback. Reads the per-rule pass/fail map from
 * the shared validatePassword() helper and renders a 4-segment strength
 * bar plus a checklist. Same rules the server enforces — what you see in
 * the wizard is exactly what /api/signup will accept.
 */
function PasswordStrengthMeter({ check }: { check: ReturnType<typeof validatePassword> }) {
  const segmentColours = [
    'bg-red-500/70',     // Very weak (score 0)
    'bg-red-500/70',     // Weak (score 1)
    'bg-amber-500/70',   // Fair (score 2)
    'bg-emerald-500/70', // Good (score 3)
    'bg-emerald-500',    // Strong (score 4)
  ]
  const labelColours = [
    'text-red-400',
    'text-red-400',
    'text-amber-400',
    'text-emerald-400',
    'text-emerald-400',
  ]
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < check.score ? segmentColours[check.score] : 'bg-white/10'
            }`}
          />
        ))}
        <span className={`text-xs font-medium ml-1 ${labelColours[check.score]}`}>{check.label}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <RuleItem ok={check.rules.length} text={`${PASSWORD_MIN_LENGTH}+ characters`} />
        <RuleItem ok={check.rules.upper} text="One uppercase" />
        <RuleItem ok={check.rules.lower} text="One lowercase" />
        <RuleItem ok={check.rules.digit} text="One number" />
        <RuleItem ok={check.rules.symbol} text="One symbol" />
        <RuleItem ok={check.rules.notCommon && check.rules.notPersonal} text="Not too obvious" />
      </ul>
    </div>
  )
}

function RuleItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span className={`inline-block w-3 h-3 rounded-full text-[8px] leading-3 text-center ${ok ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
        {ok ? '\u2713' : ''}
      </span>
      {text}
    </li>
  )
}
