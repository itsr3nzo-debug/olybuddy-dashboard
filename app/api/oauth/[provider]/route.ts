import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "crypto";
import { getOAuthConfig, getOAuthProviderId } from "@/lib/integrations-config";
import { composio, getComposioProvider } from "@/lib/composio";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const origin = new URL(req.url).origin;

  // Verify authenticated user
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // RBAC — only owners + super_admins can connect/disconnect integrations.
  const role = user.app_metadata?.role ?? "member";
  if (role !== "owner" && role !== "super_admin") {
    return NextResponse.redirect(new URL(`/integrations?error=unauthorized`, req.url));
  }

  const clientId = user.app_metadata?.client_id;
  if (!clientId) {
    return NextResponse.redirect(new URL(`/integrations?error=no_client_id`, req.url));
  }

  // ─── Path A: Composio-managed OAuth (Gmail, Calendar, Slack, HubSpot, QuickBooks, Calendly) ───
  const composioCfg = getComposioProvider(provider);
  if (composioCfg) {
    try {
      const callbackUrl = `${origin}/api/oauth/${provider}/callback`;
      // allowMultiple: true — Composio otherwise throws ComposioMultipleConnectedAccountsError
      // when the user/auth_config pair already has any connection (including stale/failed ones
      // from prior attempts). Without this flag the reconnect path is permanently broken once
      // a user has attempted a connect even once. The callback still upserts onConflict on
      // (client_id, provider), so only the latest connection is stored in integrations.
      const connection = await composio.connectedAccounts.initiate(
        clientId,
        composioCfg.authConfigId,
        { callbackUrl, allowMultiple: true }
      );

      const response = NextResponse.redirect(connection.redirectUrl!);
      response.cookies.set("composio_connection_id", connection.id, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      });
      response.cookies.set("composio_provider", provider, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      });
      return response;
    } catch (e) {
      console.error(`Composio initiate failed for ${provider}:`, e);
      return NextResponse.redirect(`${origin}/integrations?error=composio_init_failed&provider=${provider}`);
    }
  }

  // ─── Path B: Direct OAuth (Xero, Sage, FreeAgent) ───
  const config = getOAuthConfig(provider);
  if (!config) {
    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  const dClientId = process.env[config.clientIdEnv];
  if (!dClientId) {
    return NextResponse.redirect(new URL(`/integrations?error=not_configured&provider=${provider}`, req.url));
  }

  const state = randomBytes(32).toString("hex");
  const oauthProviderId = getOAuthProviderId(provider);
  const redirectUri = `${origin}/api/oauth/${oauthProviderId}/callback`;

  const authParams = new URLSearchParams({
    client_id: dClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes,
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const response = NextResponse.redirect(`${config.authUrl}?${authParams.toString()}`);
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
