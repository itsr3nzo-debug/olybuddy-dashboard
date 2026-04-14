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
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
}

export const PLAN_DETAILS: Record<string, { name: string; price: string; period: string; features: string[] }> = {
  trial: {
    name: '5-Day Trial',
    price: '£20',
    period: 'one-time',
    features: ['AI WhatsApp Employee', '24/7 lead capture', 'Automated follow-ups', '5-day full access'],
  },
  starter: {
    name: 'Starter',
    price: '£99',
    period: '/month',
    features: ['AI WhatsApp Employee', '24/7 lead capture', 'Automated follow-ups', 'CRM dashboard', 'Weekly reports'],
  },
  pro: {
    name: 'Pro',
    price: '£199',
    period: '/month',
    features: ['Everything in Starter', 'Voice call handling', 'Gmail + Calendar sync', 'Quote generation', 'Priority support'],
  },
  enterprise: {
    name: 'Enterprise',
    price: '£399',
    period: '/month',
    features: ['Everything in Pro', 'Custom integrations', 'Multi-user team', 'Dedicated account manager', 'SLA guarantee'],
  },
}

export const PERSONALITIES = [
  { value: 'professional', label: 'Professional', emoji: '👔', description: 'Polished & formal. Builds trust.' },
  { value: 'friendly', label: 'Friendly', emoji: '😊', description: 'Warm & approachable. Like a mate.' },
  { value: 'confident', label: 'Confident', emoji: '💪', description: 'Direct & efficient. No-nonsense.' },
  { value: 'cheeky', label: 'Cheeky', emoji: '😏', description: 'Witty banter. Bit of charm.' },
  { value: 'calm', label: 'Calm', emoji: '🧘', description: 'Reassuring & patient. Never flustered.' },
  { value: 'energetic', label: 'Energetic', emoji: '⚡', description: 'Enthusiastic & upbeat. High-energy.' },
  { value: 'funny', label: 'Funny', emoji: '😂', description: 'Jokes and personality. Memorable.' },
  { value: 'flirty', label: 'Flirty', emoji: '😘', description: 'Charming & playful. Smooth talker.' },
]

export const INDUSTRIES = [
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
