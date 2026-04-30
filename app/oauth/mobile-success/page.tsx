/**
 * /oauth/mobile-success?provider=gmail&status=connected
 *
 * Mobile-friendly confirmation page shown after a Composio OAuth flow that
 * was initiated from the Nexley mobile app. The mobile user is in a system
 * WebBrowser sheet at this point — we tell them to close it and return to
 * the app, and try to deep-link back via `nexley://integrations`.
 */

interface PageProps {
  searchParams: Promise<{ provider?: string; status?: string }>
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  google_calendar: 'Google Calendar',
  google: 'Google',
  outlook: 'Outlook',
  hubspot: 'HubSpot',
  slack: 'Slack',
  quickbooks: 'QuickBooks',
  calendly: 'Calendly',
  xero: 'Xero',
  sage: 'Sage',
  freeagent: 'FreeAgent',
}

export default async function MobileOAuthSuccess({ searchParams }: PageProps) {
  const { provider = '', status = 'connected' } = await searchParams
  const label = PROVIDER_LABELS[provider] ?? provider
  const ok = status === 'connected'

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{ok ? `${label} connected` : `${label} connection failed`}</title>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0b;
            color: #f5f5f4;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
          }
          .card {
            max-width: 360px;
            width: 100%;
            text-align: center;
          }
          .badge {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
            border: 1px solid;
            font-size: 28px;
          }
          .badge.ok { color: #22c55e; border-color: rgba(34, 197, 94, 0.3); background: rgba(34, 197, 94, 0.08); }
          .badge.fail { color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); }
          h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            margin: 0 0 12px;
          }
          p {
            font-size: 14px;
            line-height: 1.5;
            color: rgba(245, 245, 244, 0.65);
            margin: 0 0 24px;
          }
          .deeplink {
            display: inline-block;
            padding: 11px 18px;
            background: #f5f5f4;
            color: #0a0a0b;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 500;
            font-size: 14px;
          }
          .hint {
            margin-top: 16px;
            font-size: 12px;
            color: rgba(245, 245, 244, 0.4);
          }
        `}</style>
      </head>
      <body>
        <div className="card">
          <div className={ok ? 'badge ok' : 'badge fail'}>{ok ? '✓' : '⚠'}</div>
          <h1>{ok ? `${label} connected` : `${label} couldn't connect`}</h1>
          <p>
            {ok
              ? 'Your AI Employee can now use this integration. Return to the Nexley app to continue.'
              : 'Something went wrong on our side. Return to the Nexley app and try again.'}
          </p>
          <a className="deeplink" href={`nexley://integrations?provider=${provider}&status=${status}`}>
            Return to Nexley
          </a>
          <p className="hint">If this doesn&apos;t reopen the app, just close this window.</p>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Try the deep link automatically — if the app isn't installed,
              // nothing happens and the user reads the instructions instead.
              setTimeout(function() {
                window.location.href = 'nexley://integrations?provider=${provider}&status=${status}';
              }, 350);
            `,
          }}
        />
      </body>
    </html>
  )
}
