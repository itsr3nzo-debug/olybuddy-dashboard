/**
 * Centralized Integration Provider Registry.
 *
 * Two sources combine into the final PROVIDERS list:
 *   1. CURATED (below) — hand-tuned entries with specific descriptions,
 *      icon colors, and category assignments. ~22 providers our customers
 *      care about most.
 *   2. AUTO from composio-registry.json — every other Composio-managed
 *      toolkit (~100 more), categorized automatically.
 *
 * OAuth routes look up via getComposioProvider() in lib/composio.ts.
 */

import composioRegistry from './composio-registry.json'

export interface ProviderOAuthConfig {
  authUrl: string
  tokenUrl: string
  userinfoUrl?: string
  revokeUrl?: string
  scopes: string
  clientIdEnv: string
  clientSecretEnv: string
}

export type ProviderCategory =
  | 'communication'
  | 'scheduling'
  | 'accounting'
  | 'documents'
  | 'practice'
  | 'tax'
  | 'reporting'
  | 'crm'
  | 'payments'
  | 'productivity'
  | 'social'
  | 'storage'
  | 'meetings'
  | 'marketing'
  | 'support'
  | 'devtools'
  | 'data'
  | 'other'

export interface ProviderPATConfig {
  // For integrations that use a Personal Access Token (pasted by the user) instead of OAuth.
  // The user clicks Connect → we show a modal asking for the token → we store it encrypted.
  tokenName: string // e.g., "Fergus API key" shown in the UI
  helpUrl: string // link to the provider's docs on how to generate the PAT
  placeholder?: string // placeholder text for the input
  validateUrl?: string // if set, we GET this (with Authorization: Bearer <token>) to validate before saving
}

export interface ProviderConfig {
  id: string
  name: string
  description: string
  category: ProviderCategory
  iconColor: string // tailwind dark-mode classes
  iconUrl?: string // path to brand SVG in /public/integrations/
  available: boolean // true = OAuth wired, false = "Coming Soon"
  oauth?: ProviderOAuthConfig
  pat?: ProviderPATConfig // alternative auth mode — pasted token
  createsDualRows?: string[] // e.g., Google creates ['gmail', 'google_calendar']
  oauthProvider?: string // if this row maps to a different OAuth provider (e.g., gmail → google)
  recommendedForTrades?: boolean // surface in "Recommended for Trades" section
}

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'communication', label: 'Communication' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'crm', label: 'CRM' },
  { id: 'documents', label: 'Documents' },
  { id: 'storage', label: 'File Storage' },
  { id: 'meetings', label: 'Meetings & Video' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'social', label: 'Social' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'support', label: 'Customer Support' },
  { id: 'practice', label: 'Practice Management' },
  { id: 'tax', label: 'Tax & Compliance' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'payments', label: 'Payments' },
  { id: 'devtools', label: 'Developer Tools' },
  { id: 'data', label: 'Data & Analytics' },
  { id: 'other', label: 'Other' },
]

const CURATED_PROVIDERS: ProviderConfig[] = [
  // ═══ Communication ═══
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails on behalf of the client',
    category: 'communication',
    iconColor: 'bg-red-900/20 text-red-400',
    available: true,
    recommendedForTrades: true,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    description: 'Microsoft 365 email — read, send, and manage emails',
    category: 'communication',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send updates and alerts to Slack channels',
    category: 'communication',
    iconColor: 'bg-purple-900/20 text-purple-400',
    available: true,
    oauth: {
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      userinfoUrl: 'https://slack.com/api/auth.test',
      revokeUrl: 'https://slack.com/api/auth.revoke',
      scopes: 'chat:write channels:read users:read',
      clientIdEnv: 'SLACK_CLIENT_ID',
      clientSecretEnv: 'SLACK_CLIENT_SECRET',
    },
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    description: 'Team messaging, channels, and collaboration',
    category: 'communication',
    iconColor: 'bg-indigo-900/20 text-indigo-400',
    available: true,
  },

  // ═══ Scheduling ═══
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync appointments and book jobs automatically',
    category: 'scheduling',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: true,
    recommendedForTrades: true,
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Client booking and appointment scheduling',
    category: 'scheduling',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: true,
    oauth: {
      authUrl: 'https://auth.calendly.com/oauth/authorize',
      tokenUrl: 'https://auth.calendly.com/oauth/token',
      userinfoUrl: 'https://api.calendly.com/users/me',
      scopes: 'default',
      clientIdEnv: 'CALENDLY_CLIENT_ID',
      clientSecretEnv: 'CALENDLY_CLIENT_SECRET',
    },
  },
  {
    id: 'outlook_calendar',
    name: 'Outlook Calendar',
    description: 'Microsoft 365 calendar — sync appointments automatically',
    category: 'scheduling',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: true,
    oauthProvider: 'outlook',
  },

  // ═══ Accounting ═══
  {
    id: 'xero',
    name: 'Xero',
    description: 'Invoices, contacts, bank reconciliation, VAT/CIS — Nexley drafts, you approve',
    category: 'accounting',
    iconColor: 'bg-cyan-900/20 text-cyan-400',
    available: true,
    recommendedForTrades: true,
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      userinfoUrl: 'https://api.xero.com/connections',
      revokeUrl: 'https://identity.xero.com/connect/revocation',
      // GRANULAR scopes — required for apps created after 2 Mar 2026 (Nexley's
      // Xero app was registered 2026-04-17, so we're on the new-granular system).
      // The older broad scopes `accounting.transactions.read` and
      // `accounting.reports.read` are REJECTED by Xero's OAuth as
      // "unauthorized_client / Invalid scope" for post-Mar-2026 apps — they
      // must be split into the specific granular scopes below.
      //
      // Verified against Xero docs 2026-04-20 (developer.xero.com/documentation/guides/oauth2/scopes):
      //   ✅ accounting.contacts                     — contact CRUD
      //   ✅ accounting.invoices                     — invoice CRUD (read included)
      //   ✅ accounting.payments                     — payment CRUD
      //   ✅ accounting.banktransactions.read        — bank transactions (replaces part of transactions.read)
      //   ✅ accounting.settings.read                — chart of accounts, items, tax rates, currencies
      //   ✅ accounting.reports.aged.read            — aged receivables/payables (chase-overdue skill)
      //   ✅ accounting.reports.profitandloss.read   — P&L (monthly brief)
      //   ✅ accounting.reports.balancesheet.read    — BS
      //   ✅ accounting.reports.trialbalance.read    — TB
      //   ✅ accounting.reports.taxreports.read      — VAT return (MTD)
      //   ✅ offline_access                          — refresh tokens
      // Existing clients who authorised before this change must reconnect to
      // pick up the new scope set (Xero consent screen re-prompts).
      scopes: 'openid profile email accounting.contacts accounting.invoices accounting.payments accounting.banktransactions.read accounting.settings.read accounting.reports.aged.read accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.trialbalance.read accounting.reports.taxreports.read offline_access',
      clientIdEnv: 'XERO_CLIENT_ID',
      clientSecretEnv: 'XERO_CLIENT_SECRET',
    },
  },
  {
    // Fergus now offers self-serve PATs (shipped 2025). Path in Fergus web app:
    // Settings (gear) → Integrations → Fergus API → Generate PAT → Copy.
    // Help article: https://help.fergus.com/en/articles/14605426-fergus-api-personal-access-tokens-pats
    id: 'fergus',
    name: 'Fergus',
    description: 'Trade job management — push captured jobs from WhatsApp straight to your Fergus board',
    category: 'practice',
    iconColor: 'bg-orange-900/20 text-orange-400',
    available: true,
    recommendedForTrades: true,
    pat: {
      tokenName: 'Fergus Personal Access Token',
      helpUrl: 'https://help.fergus.com/en/articles/14605426-fergus-api-personal-access-tokens-pats',
      placeholder: 'Paste PAT from Fergus → Settings → Integrations → Fergus API',
      validateUrl: 'https://api.fergus.com/users',
    },
  },
  {
    // Dext is intentionally routed through Xero instead of being a direct
    // integration. Reason: Dext's public API is partner-gated (sales-led,
    // uncertain approval). ~80% of what trades customers want Dext for
    // (total supplier spend, bills by supplier) is readable via Xero Bills
    // because Dext auto-syncs everything to Xero. Tile exists so customers
    // see the coverage story — clicking it just points them at Xero.
    id: 'dext',
    name: 'Dext (via Xero)',
    description: 'Supplier receipts + spend analysis. Connect Xero → Dext already syncs to it → Nexley reads your bills.',
    category: 'accounting',
    iconColor: 'bg-violet-900/20 text-violet-400',
    available: false, // rendered as info-only tile, not clickable for connection
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting, invoicing, and expense tracking',
    category: 'accounting',
    iconColor: 'bg-green-900/20 text-green-400',
    available: true,
    oauth: {
      authUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      userinfoUrl: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
      revokeUrl: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
      scopes: 'com.intuit.quickbooks.accounting openid profile email',
      clientIdEnv: 'QUICKBOOKS_CLIENT_ID',
      clientSecretEnv: 'QUICKBOOKS_CLIENT_SECRET',
    },
  },
  {
    id: 'sage',
    name: 'Sage',
    description: 'Business accounting and financial management',
    category: 'accounting',
    iconColor: 'bg-green-900/20 text-green-400',
    available: true,
    oauth: {
      authUrl: 'https://www.sageone.com/oauth2/auth/central?filter=apiv3.1',
      tokenUrl: 'https://oauth.accounting.sage.com/token',
      userinfoUrl: 'https://api.accounting.sage.com/v3.1/user',
      scopes: 'full_access',
      clientIdEnv: 'SAGE_CLIENT_ID',
      clientSecretEnv: 'SAGE_CLIENT_SECRET',
    },
  },
  {
    id: 'freeagent',
    name: 'FreeAgent',
    description: 'Freelancer accounting, invoicing, and expenses',
    category: 'accounting',
    iconColor: 'bg-teal-900/20 text-teal-400',
    available: true,
    oauth: {
      authUrl: 'https://api.freeagent.com/v2/approve_app',
      tokenUrl: 'https://api.freeagent.com/v2/token_endpoint',
      userinfoUrl: 'https://api.freeagent.com/v2/users/me',
      scopes: '',
      clientIdEnv: 'FREEAGENT_CLIENT_ID',
      clientSecretEnv: 'FREEAGENT_CLIENT_SECRET',
    },
  },

  // ═══ Document Processing ═══
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive',
    category: 'documents',
    iconColor: 'bg-green-900/20 text-green-400',
    available: true,
  },
  {
    id: 'one_drive',
    name: 'OneDrive',
    description: 'Microsoft 365 cloud storage — access and manage files',
    category: 'storage',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: true,
  },
  {
    id: 'share_point',
    name: 'SharePoint',
    description: 'Microsoft 365 team sites and document libraries',
    category: 'documents',
    iconColor: 'bg-teal-900/20 text-teal-400',
    available: true,
  },
  {
    id: 'dext',
    name: 'Dext',
    description: 'Receipt and invoice data extraction',
    category: 'documents',
    iconColor: 'bg-orange-900/20 text-orange-400',
    available: false,
  },
  {
    id: 'hubdoc',
    name: 'HubDoc',
    description: 'Automated document collection for Xero',
    category: 'documents',
    iconColor: 'bg-emerald-900/20 text-emerald-400',
    available: false,
  },

  // ═══ Practice Management ═══
  {
    id: 'ignition',
    name: 'Ignition',
    description: 'Client proposals, engagement letters, and billing',
    category: 'practice',
    iconColor: 'bg-orange-900/20 text-orange-400',
    available: false,
  },
  {
    id: 'brightmanager',
    name: 'BrightManager',
    description: 'Practice management and workflow',
    category: 'practice',
    iconColor: 'bg-yellow-900/20 text-yellow-400',
    available: false,
  },
  {
    id: 'pixie',
    name: 'Pixie',
    description: 'Simple workflow management for smaller firms',
    category: 'practice',
    iconColor: 'bg-pink-900/20 text-pink-400',
    available: false,
  },

  // ═══ Tax & Compliance ═══
  {
    id: 'taxcalc',
    name: 'TaxCalc',
    description: 'Tax return preparation and filing',
    category: 'tax',
    iconColor: 'bg-red-900/20 text-red-400',
    available: false,
  },
  {
    id: 'iris',
    name: 'Iris',
    description: 'Statutory accounts and tax compliance',
    category: 'tax',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: false,
  },

  // ═══ Reporting ═══
  {
    id: 'fathom',
    name: 'Fathom',
    description: 'Visual financial reporting and analysis',
    category: 'reporting',
    iconColor: 'bg-violet-900/20 text-violet-400',
    available: true,
  },
  {
    id: 'spotlight',
    name: 'Spotlight Reporting',
    description: 'Forecasting and management reporting',
    category: 'reporting',
    iconColor: 'bg-amber-900/20 text-amber-400',
    available: false,
  },

  // ═══ CRM ═══
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Marketing, sales CRM, and service desk',
    category: 'crm',
    iconColor: 'bg-orange-900/20 text-orange-400',
    available: true,
    oauth: {
      authUrl: 'https://app.hubspot.com/oauth/authorize',
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      userinfoUrl: 'https://api.hubapi.com/oauth/v1/access-tokens/',
      revokeUrl: 'https://api.hubapi.com/oauth/v1/refresh-tokens/',
      scopes: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read',
      clientIdEnv: 'HUBSPOT_CLIENT_ID',
      clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
    },
  },

  // ═══ Payments ═══
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and subscription billing',
    category: 'payments',
    iconColor: 'bg-violet-900/20 text-violet-400',
    available: true,
    recommendedForTrades: true,
  },
]

// ═══ Auto-generated providers from Composio registry ═══
// Every Composio-managed toolkit not already in CURATED_PROVIDERS
// becomes a provider entry, categorized from the toolkit's metadata.

type ComposioRegistryEntry = { authConfigId: string; name: string; categories: string[] }
const REGISTRY = composioRegistry as Record<string, ComposioRegistryEntry>

// Map dashboard provider IDs to Composio toolkit slugs (mismatches only)
const PROVIDER_TO_TOOLKIT: Record<string, string> = {
  google_calendar: 'googlecalendar',
  google_drive: 'googledrive',
}
// Reverse: toolkit slug → curated provider ID
const TOOLKIT_TO_CURATED_ID = new Map<string, string>()
for (const p of CURATED_PROVIDERS) {
  const toolkitSlug = PROVIDER_TO_TOOLKIT[p.id] || p.id
  TOOLKIT_TO_CURATED_ID.set(toolkitSlug, p.id)
}

// Categorize a Composio toolkit by inspecting its first category string
function categorizeFromComposio(rawCats: string[]): ProviderCategory {
  const c = (rawCats[0] || '').toLowerCase()
  if (c.includes('crm') || c.includes('contact')) return 'crm'
  if (c.includes('accounting') || c.includes('invoice')) return 'accounting'
  if (c.includes('email') && c.includes('newsletter')) return 'marketing'
  if (c === 'email') return 'communication'
  if (c.includes('chat') || c.includes('communication') || c.includes('messaging')) return 'communication'
  if (c.includes('phone') || c.includes('sms')) return 'communication'
  if (c.includes('calendar') || c.includes('scheduling') || c.includes('booking')) return 'scheduling'
  if (c.includes('file') || c.includes('storage')) return 'storage'
  if (c.includes('document') || c.includes('signature') || c.includes('docs')) return 'documents'
  if (c.includes('video') || c.includes('meeting') || c.includes('conference')) return 'meetings'
  if (c.includes('social media') || c.includes('social')) return 'social'
  if (c.includes('marketing') || c.includes('ads')) return 'marketing'
  if (c.includes('support') || c.includes('helpdesk') || c.includes('customer')) return 'support'
  if (c.includes('developer') || c.includes('devtools')) return 'devtools'
  if (c.includes('database') || c.includes('analytics') || c.includes('intelligence') || c.includes('data')) return 'data'
  if (c.includes('payment')) return 'payments'
  if (c.includes('project') || c.includes('task') || c.includes('productivity') || c.includes('notes') || c.includes('spreadsheet')) return 'productivity'
  return 'other'
}

const CATEGORY_COLORS: Record<ProviderCategory, string> = {
  communication: 'bg-blue-900/20 text-blue-400',
  scheduling: 'bg-sky-900/20 text-sky-400',
  accounting: 'bg-emerald-900/20 text-emerald-400',
  documents: 'bg-amber-900/20 text-amber-400',
  storage: 'bg-yellow-900/20 text-yellow-400',
  meetings: 'bg-cyan-900/20 text-cyan-400',
  social: 'bg-pink-900/20 text-pink-400',
  marketing: 'bg-rose-900/20 text-rose-400',
  support: 'bg-orange-900/20 text-orange-400',
  crm: 'bg-violet-900/20 text-violet-400',
  productivity: 'bg-indigo-900/20 text-indigo-400',
  payments: 'bg-violet-900/20 text-violet-400',
  practice: 'bg-purple-900/20 text-purple-400',
  tax: 'bg-red-900/20 text-red-400',
  reporting: 'bg-amber-900/20 text-amber-400',
  devtools: 'bg-slate-700/30 text-slate-300',
  data: 'bg-teal-900/20 text-teal-400',
  other: 'bg-slate-700/30 text-slate-300',
}

const AUTO_PROVIDERS: ProviderConfig[] = []
for (const [slug, entry] of Object.entries(REGISTRY)) {
  if (TOOLKIT_TO_CURATED_ID.has(slug)) continue // already curated
  const category = categorizeFromComposio(entry.categories)
  AUTO_PROVIDERS.push({
    id: slug,
    name: entry.name,
    description: entry.categories.slice(0, 2).join(' · ') || 'Composio integration',
    category,
    iconColor: CATEGORY_COLORS[category],
    available: true,
  })
}

// Brand icons: every provider now has an SVG in /public/integrations/{id}.svg
// Curated providers with underscored IDs need hyphen mapping for filenames.
const CURATED_ICON_OVERRIDES: Record<string, string> = {
  microsoft_teams: 'microsoft-teams', google_calendar: 'google-calendar',
  outlook_calendar: 'outlook-calendar', google_drive: 'google-drive',
}

function applyIcons(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p => {
    const iconFile = CURATED_ICON_OVERRIDES[p.id] || p.id
    return { ...p, iconUrl: `/integrations/${iconFile}.svg` }
  })
}

export const PROVIDERS: ProviderConfig[] = [
  ...applyIcons(CURATED_PROVIDERS),
  ...applyIcons(AUTO_PROVIDERS).sort((a, b) => a.name.localeCompare(b.name)),
]

// ═══ Google OAuth (special case — one flow, two integration rows) ═══
export const GOOGLE_OAUTH_CONFIG: ProviderOAuthConfig = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userinfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email openid',
  clientIdEnv: 'GOOGLE_CLIENT_ID',
  clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
}

// ═══ Helpers ═══

export function getProvider(id: string): ProviderConfig | undefined {
  return PROVIDERS.find(p => p.id === id)
}

export function getOAuthConfig(providerId: string): ProviderOAuthConfig | undefined {
  const provider = getProvider(providerId)
  if (!provider) return undefined

  // Google suite shares one OAuth flow
  if (provider.oauthProvider === 'google' || providerId === 'google') {
    return GOOGLE_OAUTH_CONFIG
  }

  return provider.oauth
}

export function getAvailableProviders(): ProviderConfig[] {
  return PROVIDERS.filter(p => p.available)
}

export function getProvidersByCategory(category: string): ProviderConfig[] {
  if (category === 'all') return PROVIDERS
  return PROVIDERS.filter(p => p.category === category)
}

/** Get the OAuth provider ID to use for initiating the flow (e.g., gmail → google) */
export function getOAuthProviderId(integrationId: string): string {
  const provider = getProvider(integrationId)
  return provider?.oauthProvider ?? integrationId
}
