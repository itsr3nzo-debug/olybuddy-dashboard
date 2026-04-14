/**
 * Centralized Integration Provider Registry
 * Single source of truth for all 22 integrations.
 * OAuth routes, UI components, and disconnect logic all read from here.
 */

export interface ProviderOAuthConfig {
  authUrl: string
  tokenUrl: string
  userinfoUrl?: string
  revokeUrl?: string
  scopes: string
  clientIdEnv: string
  clientSecretEnv: string
}

export interface ProviderConfig {
  id: string
  name: string
  description: string
  category: 'communication' | 'scheduling' | 'accounting' | 'documents' | 'practice' | 'tax' | 'reporting' | 'crm' | 'payments'
  iconColor: string // tailwind dark-mode classes
  available: boolean // true = OAuth wired, false = "Coming Soon"
  oauth?: ProviderOAuthConfig
  createsDualRows?: string[] // e.g., Google creates ['gmail', 'google_calendar']
  oauthProvider?: string // if this row maps to a different OAuth provider (e.g., gmail → google)
}

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'communication', label: 'Communication' },
  { id: 'scheduling', label: 'Scheduling' },
  { id: 'crm', label: 'CRM' },
  { id: 'documents', label: 'Documents' },
  { id: 'practice', label: 'Practice Management' },
  { id: 'tax', label: 'Tax & Compliance' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'payments', label: 'Payments' },
]

export const PROVIDERS: ProviderConfig[] = [
  // ═══ Communication ═══
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails on behalf of the client',
    category: 'communication',
    iconColor: 'bg-red-900/20 text-red-400',
    available: true,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    description: 'Microsoft 365 email integration',
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
    description: 'Enterprise communication and collaboration',
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
    description: 'Microsoft 365 calendar integration',
    category: 'scheduling',
    iconColor: 'bg-blue-900/20 text-blue-400',
    available: false,
    oauthProvider: 'outlook',
  },

  // ═══ Accounting ═══
  {
    id: 'xero',
    name: 'Xero',
    description: 'Cloud accounting, invoicing, and bank feeds',
    category: 'accounting',
    iconColor: 'bg-cyan-900/20 text-cyan-400',
    available: true,
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      userinfoUrl: 'https://api.xero.com/connections',
      revokeUrl: 'https://identity.xero.com/connect/revocation',
      scopes: 'openid profile email accounting.transactions accounting.contacts offline_access',
      clientIdEnv: 'XERO_CLIENT_ID',
      clientSecretEnv: 'XERO_CLIENT_SECRET',
    },
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
  },
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
  // Google is special — gmail and google_calendar share one OAuth flow
  const provider = getProvider(providerId)
  if (!provider) return undefined

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
