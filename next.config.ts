import type { NextConfig } from "next";

/**
 * Security response headers — applied to every route.
 *
 * CSP rollout strategy (devil's-advocate fix P0 #3):
 *   The first iteration shipped CSP in enforce mode immediately. That's
 *   the textbook "shoot yourself in the foot" pattern — first deploy
 *   could 500 anything that needed an unlisted host (Stripe.js variants,
 *   YouTube embeds with new domains, etc).
 *
 *   New approach:
 *     - Default: `Content-Security-Policy-Report-Only` so violations are
 *       reported but nothing breaks.
 *     - After CSP_ENFORCE=true is set, switch to enforcing.
 *     - Reports go to /api/csp-report, which logs to integration_signals
 *       so we can review violations and tighten the policy before the flip.
 *     - 'unsafe-eval' is dropped in production builds — Next.js doesn't
 *       need it after `next build`. Dev still keeps it (HMR needs eval).
 *
 * Other headers (HSTS / X-Frame-Options / X-Content-Type-Options /
 * Referrer-Policy / Permissions-Policy) stay enforced from day one — they
 * have no risk of breaking the app.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseHost = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
// Devil's-advocate round 2 fix: the previous version dropped
// 'unsafe-eval' for prod assuming Next.js 16 + React 19 don't need it.
// That's an UNTESTED assumption — getting it wrong means the first
// production page load white-screens. Default ON until manual smoke
// test on a deployed env confirms console is clean, then set
// CSP_DROP_UNSAFE_EVAL=true to remove it.
const dropUnsafeEval = process.env.CSP_DROP_UNSAFE_EVAL === 'true'
// Set CSP_ENFORCE=true once you've reviewed CSP report logs and are
// confident the policy is complete. Until then, browsers report but
// don't block — safe deploy.
const enforceCsp = process.env.CSP_ENFORCE === 'true'

// Absolute report URL — some browsers (Firefox, older Safari) silently
// drop reports for relative report-uri. Build the absolute URL from
// NEXT_PUBLIC_SITE_URL with a sane fallback.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://nexley.vercel.app')
const CSP_REPORT_URL = `${SITE_URL.replace(/\/$/, '')}/api/csp-report`

const cspDirectives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    // 'unsafe-eval' is required by Next.js dev HMR (uses Function()).
    // Production may or may not need it depending on Next.js + React
    // versions and which features are in use. Default ON for safety;
    // flip CSP_DROP_UNSAFE_EVAL=true after a deployed smoke test
    // confirms the console is clean.
    ...(dropUnsafeEval ? [] : ["'unsafe-eval'"]),
    'https://js.stripe.com',
    'https://m.stripe.network',
    'https://va.vercel-scripts.com',
    'https://vercel.live',
    // The Nexley Mobile prototype at /preview/mobile loads React + Babel
    // Standalone via unpkg. Allowed only in script-src; not in connect-src
    // so it can't be used as a data exfil channel.
    'https://unpkg.com',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Tailwind JIT + motion/react animations
    'https://fonts.googleapis.com',
  ],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https:', // Supabase storage, Google profile pics, Stripe receipts, etc.
  ],
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
    'data:',
  ],
  'connect-src': [
    "'self'",
    supabaseHost ? `https://${supabaseHost}` : 'https://*.supabase.co',
    supabaseHost ? `wss://${supabaseHost}` : 'wss://*.supabase.co',
    'https://api.stripe.com',
    'https://m.stripe.network',
    'https://api.telegram.org',
    'https://api.openai.com',
    'https://*.vercel-analytics.com',
    'https://*.vercel-insights.com',
    'https://vitals.vercel-insights.com',
    'https://vercel.live',
    'wss://ws-us3.pusher.com', // Vercel live preview
  ],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://m.stripe.network',
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://www.loom.com',
    'https://vercel.live',
  ],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'", 'https://checkout.stripe.com', 'https://billing.stripe.com'],
  'upgrade-insecure-requests': [],
  // Use absolute URL — some browsers (Firefox, older Safari) silently drop
  // reports for relative report-uri values, which would mean we'd see
  // zero violations and falsely conclude the policy is clean.
  'report-uri': [CSP_REPORT_URL],
  // Modern Reporting API replacement for report-uri. References the
  // Reporting-Endpoints header below.
  'report-to': ['csp-endpoint'],
}

function buildCsp(): string {
  return Object.entries(cspDirectives)
    .map(([k, v]) => v.length === 0 ? k : `${k} ${v.join(' ')}`)
    .join('; ')
}

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=15552000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'usb=()',
      'magnetometer=()',
      'accelerometer=()',
      'gyroscope=()',
      'payment=(self "https://checkout.stripe.com")',
    ].join(', '),
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  // Modern Reporting API endpoint (paired with report-to in the CSP).
  // Browsers require this be a same-origin or absolute URL.
  {
    key: 'Reporting-Endpoints',
    value: `csp-endpoint="${CSP_REPORT_URL}"`,
  },
  // The CSP itself — Report-Only by default, enforcing once CSP_ENFORCE=true.
  // Keeping both names so they share the same value but the active one
  // depends on the env flag.
  {
    key: enforceCsp ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    value: buildCsp(),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every page + API route. The Stripe webhook ignores
        // CSP (no browser involved) so this is safe.
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    return [
      // Mobile prototype — preserves all relative-path requires inside the
      // bundled HTML. /preview/mobile + /preview/mobile/* both serve from
      // /public/preview-mobile/.
      {
        source: '/preview/mobile',
        destination: '/preview-mobile/index.html',
      },
      {
        source: '/preview/mobile/:file*',
        destination: '/preview-mobile/:file*',
      },
    ]
  },
};

export default nextConfig;
