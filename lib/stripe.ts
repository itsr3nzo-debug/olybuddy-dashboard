import Stripe from 'stripe'

// Lazy initialization — only creates the Stripe client when first called
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')
  }
  return _stripe
}

// Alias for backwards compatibility with dynamic imports
export const stripe = {
  get checkout() { return getStripe().checkout },
  get customers() { return getStripe().customers },
  get subscriptions() { return getStripe().subscriptions },
}

// Map plan slugs to Stripe Price IDs (set in env vars after creating in Stripe Dashboard)
export const PLAN_PRICES: Record<string, string | undefined> = {
  trial: process.env.STRIPE_PRICE_TRIAL,
  employee: process.env.STRIPE_PRICE_EMPLOYEE,
  voice: process.env.STRIPE_PRICE_VOICE,
}

export const PLAN_DETAILS: Record<string, { name: string; subtitle: string; price: string; period: string; features: string[] }> = {
  trial: {
    name: '5-Day Trial',
    subtitle: 'See the results before you commit',
    price: '£20',
    period: 'one-time',
    features: [
      'Full AI WhatsApp Employee',
      '24/7 lead capture & responses',
      'Automated follow-ups',
      'CRM dashboard access',
    ],
  },
  employee: {
    name: 'AI Employee',
    subtitle: 'Your always-on AI team member',
    price: '£599',
    period: '/month',
    features: [
      'AI WhatsApp & message handling',
      '24/7 lead capture & follow-up',
      'CRM dashboard & reports',
      'Appointment booking',
      'Monthly performance review',
    ],
  },
  voice: {
    name: 'AI Employee + Voice',
    subtitle: 'Every message and every call, handled',
    price: '£999',
    period: '/month',
    features: [
      'Everything in AI Employee',
      'Answers every inbound call',
      'Handles call enquiries & bookings',
      'Never misses an out-of-hours call',
      'Priority support',
    ],
  },
}

export const PERSONALITIES = [
  { value: 'optimistic', label: 'Optimistic', emoji: '🌟', description: 'Warm, upbeat & positive. Customers love it.' },
  { value: 'balanced', label: 'Balanced', emoji: '⚖️', description: 'Professional & balanced. Straight to the point.' },
  { value: 'analytical', label: 'Analytical', emoji: '🧠', description: 'Detail-focused & thorough. Asks the right questions.' },
]

export const INDUSTRIES = [
  { value: 'accountant', label: 'Accountant' },
  { value: 'solicitor', label: 'Solicitor' },
  { value: 'landscaper', label: 'Landscaper' },
  { value: 'electrician', label: 'Electrician' },
  { value: 'plumber', label: 'Plumber' },
  { value: 'builder', label: 'Builder' },
  { value: 'roofer', label: 'Roofer' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'fencing', label: 'Fencing' },
  { value: 'paving', label: 'Paving' },
  { value: 'decking', label: 'Decking' },
  { value: 'tree-surgeon', label: 'Tree Surgeon' },
  { value: 'cleaner', label: 'Cleaning Company' },
  { value: 'dental', label: 'Dental Practice' },
  { value: 'estate-agent', label: 'Estate Agent' },
  { value: 'solicitor', label: 'Solicitor' },
  { value: 'recruitment', label: 'Recruitment Agency' },
  { value: 'hair-salon', label: 'Hair Salon' },
  { value: 'dog-groomer', label: 'Dog Groomer' },
]
