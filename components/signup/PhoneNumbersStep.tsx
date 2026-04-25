'use client'

/**
 * PhoneNumbersStep — standalone signup component for collecting the two
 * critical WhatsApp numbers:
 *
 *   1. Business WhatsApp (eSIM number — the agent pairs to this)
 *   2. Owner's personal WhatsApp (the owner messages the bot from this)
 *
 * This distinction is what powers the Sender Role Protocol on the VPS — the
 * agent treats messages from owner_phone as OWNER commands and everything else
 * as CUSTOMER enquiries. Without both numbers collected upfront, the agent
 * cannot distinguish owner from customer.
 *
 * Drop-in usage in the signup wizard:
 *
 *   <PhoneNumbersStep
 *     businessWhatsapp={form.business_whatsapp}
 *     ownerPhone={form.owner_phone}
 *     ownerName={form.owner_name ?? form.contact_name}
 *     onChange={(field, value) => update(field, value)}
 *   />
 *
 * Then in canProceed(): require both valid UK mobiles + they must differ.
 */

import { useMemo } from 'react'
import { Phone, User, Smartphone, Check, AlertCircle } from 'lucide-react'
import { motion } from 'motion/react'

const UK_PHONE_RE = /^(\+?44|0)7\d{9}$/

function normalize(input: string): string {
  const digits = input.replace(/[^\d+]/g, '')
  if (/^\+447\d{9}$/.test(digits)) return digits.slice(1)
  if (/^447\d{9}$/.test(digits)) return digits
  if (/^07\d{9}$/.test(digits)) return '44' + digits.slice(1)
  return ''
}

function valid(input: string): boolean {
  return UK_PHONE_RE.test(input.replace(/\s/g, ''))
}

type Props = {
  businessWhatsapp: string
  ownerPhone: string
  ownerName: string
  onChange: (field: 'business_whatsapp' | 'owner_phone' | 'owner_name', value: string) => void
}

export default function PhoneNumbersStep({ businessWhatsapp, ownerPhone, ownerName, onChange }: Props) {
  const bizNormalized = useMemo(() => normalize(businessWhatsapp), [businessWhatsapp])
  const ownerNormalized = useMemo(() => normalize(ownerPhone), [ownerPhone])

  const bizValid = businessWhatsapp.length === 0 ? null : valid(businessWhatsapp)
  const ownerValid = ownerPhone.length === 0 ? null : valid(ownerPhone)

  const sameNumber =
    bizNormalized && ownerNormalized && bizNormalized === ownerNormalized

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">Set up WhatsApp</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your AI Employee lives on a dedicated WhatsApp number — separate from your personal one.
          This way it can tell your messages (owner) apart from customers.
        </p>
      </div>

      {/* Explainer card */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-brand-accent/20 bg-brand-accent/5 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-brand-accent/10 text-brand-accent">
            <Smartphone size={16} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Get a second eSIM for your AI Employee
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Order a UK eSIM from{' '}
              <a
                href="https://secondsim.co.uk"
                target="_blank"
                rel="noreferrer"
                className="text-brand-accent underline hover:no-underline"
              >
                secondsim.co.uk
              </a>{' '}
              (£5–10/mo). Activate it on your phone, register that number on WhatsApp Business,
              then enter it below. This becomes your AI Employee&apos;s number — customers text it,
              it replies 24/7.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Business WhatsApp */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          <span className="inline-flex items-center gap-1.5">
            <Phone size={14} className="text-muted-foreground" />
            Business WhatsApp number <span className="text-brand-danger">*</span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground mb-2">
          The eSIM number your AI Employee will pair to. Customers message this.
        </p>
        <div className="relative">
          <input
            type="tel"
            value={businessWhatsapp}
            onChange={(e) => onChange('business_whatsapp', e.target.value)}
            placeholder="07xxx xxx xxx"
            autoComplete="off"
            className={`w-full rounded-lg border bg-card-bg px-3 py-3 sm:py-2 pr-9 text-base sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 transition-colors ${
              bizValid === false
                ? 'border-brand-danger/40 focus:ring-brand-danger/30'
                : bizValid
                ? 'border-brand-success/40 focus:ring-brand-success/30'
                : 'border-border focus:ring-brand-accent/30'
            }`}
          />
          {bizValid === true && (
            <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-success" />
          )}
          {bizValid === false && (
            <AlertCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-danger" />
          )}
        </div>
        {bizValid === false && (
          <p className="text-xs text-brand-danger mt-1">Enter a valid UK mobile (starts with 07, +44, or 447)</p>
        )}
      </div>

      {/* Owner personal WhatsApp */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          <span className="inline-flex items-center gap-1.5">
            <User size={14} className="text-muted-foreground" />
            Your personal WhatsApp number <span className="text-brand-danger">*</span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground mb-2">
          The number you&apos;ll message the AI from. This identifies you as the owner — commands from this number get executed, not treated like customer enquiries.
        </p>
        <div className="relative">
          <input
            type="tel"
            value={ownerPhone}
            onChange={(e) => onChange('owner_phone', e.target.value)}
            placeholder="07xxx xxx xxx"
            autoComplete="off"
            className={`w-full rounded-lg border bg-card-bg px-3 py-3 sm:py-2 pr-9 text-base sm:text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 transition-colors ${
              ownerValid === false || sameNumber
                ? 'border-brand-danger/40 focus:ring-brand-danger/30'
                : ownerValid
                ? 'border-brand-success/40 focus:ring-brand-success/30'
                : 'border-border focus:ring-brand-accent/30'
            }`}
          />
          {ownerValid === true && !sameNumber && (
            <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-success" />
          )}
          {(ownerValid === false || sameNumber) && (
            <AlertCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-danger" />
          )}
        </div>
        {ownerValid === false && (
          <p className="text-xs text-brand-danger mt-1">Enter a valid UK mobile</p>
        )}
        {sameNumber && (
          <p className="text-xs text-brand-danger mt-1">
            This must be different to your business number. One is for your AI Employee (customers text it), the other is yours (you text the AI).
          </p>
        )}
      </div>

      {/* Owner name — optional */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          <span className="inline-flex items-center gap-1.5">
            <User size={14} className="text-muted-foreground" />
            Your first name
            <span className="text-muted-foreground font-normal">(so the AI knows what to call you)</span>
          </span>
        </label>
        <input
          type="text"
          value={ownerName}
          onChange={(e) => onChange('owner_name', e.target.value)}
          placeholder="Kade"
          autoComplete="given-name"
          className="w-full rounded-lg border border-border bg-card-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
        />
      </div>

      {/* Summary card */}
      {bizValid && ownerValid && !sameNumber && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-brand-success/20 bg-brand-success/5 p-4"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-brand-success">
              <Check size={16} />
            </div>
            <div className="flex-1 text-xs text-foreground">
              <p className="font-medium mb-1">All set. Here&apos;s how this will work:</p>
              <ul className="space-y-0.5 text-muted-foreground">
                <li>• Customers text <span className="text-foreground font-mono">{businessWhatsapp}</span> → your AI Employee replies.</li>
                <li>• You text from <span className="text-foreground font-mono">{ownerPhone}</span> → the AI treats you as the boss, runs commands.</li>
                {ownerName && <li>• The AI will call you <span className="text-foreground">{ownerName}</span>.</li>}
              </ul>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// Exported validator so the parent signup wizard can reuse in canProceed()
export function phoneNumbersStepValid(businessWhatsapp: string, ownerPhone: string): boolean {
  if (!valid(businessWhatsapp) || !valid(ownerPhone)) return false
  return normalize(businessWhatsapp) !== normalize(ownerPhone)
}
