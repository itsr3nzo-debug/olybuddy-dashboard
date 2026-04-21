import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { encryptToken } from "@/lib/encryption";
import { getSupabase } from "@/lib/supabase";
import { getOAuthConfig, getProvider, GOOGLE_OAUTH_CONFIG } from "@/lib/integrations-config";
import { composio, getComposioProvider } from "@/lib/composio";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { searchParams, origin } = new URL(req.url);

  // ─── Path A: Composio-managed callback ───
  // Composio redirects back here after user authorizes. We look up the connection
  // we initiated, confirm it's active, and save the connected_account_id.
  const composioCfg = getComposioProvider(provider);
  if (composioCfg) {
    const connectionId = req.cookies.get("composio_connection_id")?.value;
    if (!connectionId) {
      return NextResponse.redirect(`${origin}/integrations?error=no_composio_connection`);
    }

    const authSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll(); }, setAll() {} } }
    );
    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user) return NextResponse.redirect(`${origin}/login`);

    const clientId = user.app_metadata?.client_id;
    if (!clientId) return NextResponse.redirect(`${origin}/integrations?error=no_client_id`);

    try {
      const conn: any = await composio.connectedAccounts.get(connectionId);
      const status = conn?.status || "UNKNOWN";
      if (status !== "ACTIVE") {
        console.warn(`[composio] connection ${connectionId} status=${status}`);
      }

      const admin = getSupabase();
      const providerConfig = getProvider(provider);
      const isGoogle = provider === "google" || providerConfig?.oauthProvider === "google";
      const rows = isGoogle ? ["gmail", "google_calendar"] : [provider];

      // Provider-specific metadata enrichment — capture the identifiers that
      // webhooks carry so we can route them at tenant level without a round-trip.
      // Stripe  : extract connected-account acct_* id from Composio's connection data
      // Calendar: placeholder (channel registration happens later when the agent
      //           calls events.watch — that code PATCHes this row with
      //           calendar_channel_id + calendar_resource_id)
      const enrichedMeta: Record<string, unknown> = {
        composio_connected_account_id: connectionId,
        composio_auth_config_id: composioCfg.authConfigId,
      };
      try {
        // The Composio `connectedAccounts.get` response for Stripe exposes the
        // account id in `data.auth_config_data.account_id` or in a provider-
        // specific field nested under `data.state.val.account_id`. Defensive:
        // look at a few likely paths.
        if (provider === "stripe") {
          // Normalise candidate locations — Composio has moved these fields
          // across schema versions; read defensively.
          type StripeAcctCandidate = Record<string, unknown>;
          const candidates: StripeAcctCandidate[] = [
            (conn?.data ?? {}) as StripeAcctCandidate,
            ((conn?.data as { auth_config_data?: StripeAcctCandidate })?.auth_config_data ?? {}) as StripeAcctCandidate,
            ((conn?.data as { state?: { val?: StripeAcctCandidate } })?.state?.val ?? {}) as StripeAcctCandidate,
            ((conn?.data as { connection_data?: StripeAcctCandidate })?.connection_data ?? {}) as StripeAcctCandidate,
          ];
          let stripeAcctId: string | null = null;
          for (const c of candidates) {
            const val =
              (c.stripe_account_id as string | undefined) ??
              (c.account_id as string | undefined) ??
              (c.stripe_user_id as string | undefined);
            if (typeof val === "string" && val.startsWith("acct_")) {
              stripeAcctId = val;
              break;
            }
          }
          if (stripeAcctId) {
            enrichedMeta.stripe_account_id = stripeAcctId;
            console.log(`[composio-callback] stripe enriched metadata.stripe_account_id=${stripeAcctId}`);
          } else {
            // Won't block the connection — webhooks will DLQ until the account
            // id is available via a later retrieve + patch.
            console.warn(`[composio-callback] stripe connection ${connectionId}: no acct_* id found in connection payload; webhooks will DLQ until enriched manually`);
          }
        }
      } catch (e) {
        console.warn(`[composio-callback] metadata enrichment threw for ${provider}:`, e);
      }

      for (const p of rows) {
        const { error } = await admin.from("integrations").upsert(
          {
            client_id: clientId,
            provider: p,
            status: status === "ACTIVE" ? "connected" : "pending",
            account_email: conn?.data?.user?.email || "",
            account_name: conn?.data?.user?.name || "",
            metadata: enrichedMeta,
            error_message: null,
            error_count: 0,
          },
          { onConflict: "client_id,provider" }
        );
        if (error) {
          console.error(`[composio-callback] upsert failed for ${p}:`, error);
          return NextResponse.redirect(`${origin}/integrations?error=storage_failed&provider=${p}`);
        }
      }

      // Auto-subscribe to Composio triggers so events flow to /api/webhooks/composio
      // without further configuration. Triggers are idempotent per (connection, slug).
      try {
        // Slugs verified live against Composio's /api/v3/triggers_types (2026-04-19).
        // Conventions are inconsistent per toolkit — don't guess, check before adding.
        const TRIGGER_MAP: Record<string, string[]> = {
          gmail: ["GMAIL_NEW_GMAIL_MESSAGE"],
          google_calendar: [
            "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER",
            "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_UPDATED_TRIGGER",
          ],
          stripe: [
            "STRIPE_INVOICE_PAYMENT_SUCCEEDED_TRIGGER",
            "STRIPE_PAYMENT_FAILED_TRIGGER",
            "STRIPE_CHARGE_FAILED_TRIGGER",
            "STRIPE_CHECKOUT_SESSION_COMPLETED_TRIGGER",
          ],
          slack: ["SLACK_RECEIVE_MESSAGE"],
          outlook: ["OUTLOOK_MESSAGE_TRIGGER"],
          hubspot: ["HUBSPOT_CONTACT_CREATED_TRIGGER", "HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER"],
          // calendly intentionally omitted — Composio has no triggers for it yet.
        };
        const forProviders = isGoogle ? ["gmail", "google_calendar"] : [provider];
        for (const p of forProviders) {
          const slugs = TRIGGER_MAP[p] ?? [];
          for (const slug of slugs) {
            try {
              const r = await fetch(
                `https://backend.composio.dev/api/v3/trigger_instances/${slug}/upsert`,
                {
                  method: "POST",
                  headers: { "x-api-key": process.env.COMPOSIO_API_KEY!, "content-type": "application/json" },
                  body: JSON.stringify({ connected_account_id: connectionId, trigger_config: {} }),
                },
              );
              if (!r.ok) {
                console.warn(`[composio-callback] trigger ${slug} upsert HTTP ${r.status}`);
              } else {
                console.log(`[composio-callback] subscribed trigger ${slug} for ${p}`);
              }
            } catch (e) {
              console.warn(`[composio-callback] trigger ${slug} upsert failed:`, e);
            }
          }
        }
      } catch (e) {
        console.warn(`[composio-callback] trigger auto-subscribe failed:`, e);
      }

      const response = NextResponse.redirect(`${origin}/integrations?connected=${provider}`);
      response.cookies.delete("composio_connection_id");
      response.cookies.delete("composio_provider");
      return response;
    } catch (e) {
      console.error(`[composio-callback] failed for ${provider}:`, e);
      return NextResponse.redirect(`${origin}/integrations?error=composio_callback_failed&provider=${provider}`);
    }
  }

  // ─── Path B: Direct OAuth callback (Xero, Sage, FreeAgent) ───
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oauth_state")?.value;

  // CSRF check
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${origin}/integrations?error=csrf_mismatch`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/integrations?error=no_code`);
  }

  // Get authenticated user
  const authSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const clientId = user.app_metadata?.client_id;
  if (!clientId) {
    return NextResponse.redirect(`${origin}/integrations?error=no_client_id`);
  }

  // Look up OAuth config from centralized registry
  const config = getOAuthConfig(provider);
  if (!config) {
    return NextResponse.redirect(`${origin}/integrations?error=unsupported_provider`);
  }

  const redirectUri = `${origin}/api/oauth/${provider}/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env[config.clientIdEnv]!,
      client_secret: process.env[config.clientSecretEnv]!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error(`OAuth token exchange failed for ${provider}:`, err);
    return NextResponse.redirect(`${origin}/integrations?error=token_exchange_failed`);
  }

  const tokens = await tokenRes.json();

  // Provider-specific token extraction (some providers nest tokens differently)
  let access_token: string = tokens.access_token;
  let refresh_token: string | undefined = tokens.refresh_token;
  const expires_in: number | undefined = tokens.expires_in;
  const scope: string | undefined = tokens.scope;

  // Slack returns tokens under authed_user
  if (provider === "slack" && tokens.authed_user?.access_token) {
    access_token = tokens.authed_user.access_token;
    refresh_token = tokens.authed_user.refresh_token;
  }

  // QuickBooks returns realmId at top level
  if (provider === "quickbooks" && tokens.realmId) {
    // stored in metadata below
  }

  if (!access_token) {
    console.error(`No access_token in response for ${provider}:`, JSON.stringify(tokens).slice(0, 500));
    return NextResponse.redirect(`${origin}/integrations?error=no_access_token`);
  }

  // Get account info
  let accountEmail = "";
  let accountName = "";
  let metadata: Record<string, unknown> = {};
  const provConfig = getProvider(provider);

  if (config.userinfoUrl) {
    try {
      // HubSpot userinfo requires the token appended to the URL
      const userinfoUrl = provider === "hubspot"
        ? `${config.userinfoUrl}${access_token}`
        : config.userinfoUrl;

      const userinfoRes = await fetch(userinfoUrl, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (userinfoRes.ok) {
        const info = await userinfoRes.json();

        if (provider === "google") {
          // Google userinfo
          accountEmail = info.email || "";
          accountName = info.name || "";
        } else if (provider === "xero") {
          // Xero connections endpoint returns array
          const connections = Array.isArray(info) ? info : [];
          if (connections.length > 0) {
            accountName = connections[0].tenantName || "";
            metadata.tenantId = connections[0].tenantId;
          }
        } else if (provider === "slack") {
          // Slack auth.test response
          accountEmail = info.user || "";
          accountName = info.team || "";
          metadata.teamId = info.team_id;
          metadata.userId = info.user_id;
        } else if (provider === "hubspot") {
          // HubSpot access token info
          accountEmail = info.user || "";
          accountName = info.hub_domain || "";
          metadata.hubId = info.hub_id;
        } else {
          // Generic: try common field names
          accountEmail = info.email || info.user_email || info.login || "";
          accountName = info.name || info.display_name || info.user_name || info.company_name || "";
        }
      }
    } catch (e) {
      console.warn("Failed to fetch user info:", e);
    }
  }

  // QuickBooks: token response includes realmId
  if (provider === "quickbooks" && tokens.realmId) {
    metadata.realmId = tokens.realmId;
  }
  // HubSpot: token response may include hub_id
  if (provider === "hubspot" && tokens.hub_id) {
    metadata.hubId = tokens.hub_id;
  }

  // Encrypt tokens
  let accessTokenEnc: string;
  let refreshTokenEnc: string | null;
  try {
    accessTokenEnc = encryptToken(access_token);
    refreshTokenEnc = refresh_token ? encryptToken(refresh_token) : null;
  } catch (e) {
    console.error("Token encryption failed — ENCRYPTION_KEY may not be set:", e);
    return NextResponse.redirect(`${origin}/integrations?error=encryption_config`);
  }
  const expiresAt = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : null;

  // Use service role client for writes (bypasses RLS)
  const adminSupabase = getSupabase();

  // For Google/Microsoft: create MULTIPLE integration rows from one OAuth flow
  const providerConfig = getProvider(provider);
  const isGoogle = provider === "google" || providerConfig?.oauthProvider === "google";
  const providers = isGoogle ? ["gmail", "google_calendar"] : [provider];

  for (const p of providers) {
    const { error: upsertErr } = await adminSupabase.from("integrations").upsert(
      {
        client_id: clientId,
        provider: p,
        status: "connected",
        account_email: accountEmail,
        account_name: accountName,
        access_token_enc: accessTokenEnc,
        refresh_token_enc: refreshTokenEnc,
        token_expires_at: expiresAt,
        scope: scope || "",
        error_message: null,
        error_count: 0,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
      { onConflict: "client_id,provider" }
    );

    if (upsertErr) {
      console.error(`[oauth-callback] Failed to store tokens for ${p}:`, upsertErr);
      return NextResponse.redirect(`${origin}/integrations?error=storage_failed&provider=${p}`);
    }
  }

  // Log the sync
  const { data: integration } = await adminSupabase
    .from("integrations")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", providers[0])
    .single();

  if (integration) {
    await adminSupabase.from("integration_sync_logs").insert({
      client_id: clientId,
      integration_id: integration.id,
      sync_type: "token_refresh",
      status: "success",
      records_synced: 0,
      metadata: { action: "initial_connection", provider },
    });
  }

  // Clear state cookie and redirect
  const response = NextResponse.redirect(`${origin}/integrations?connected=${provider}`);
  response.cookies.delete("oauth_state");
  return response;
}
