import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { encryptToken } from "@/lib/encryption";
import { getSupabase } from "@/lib/supabase";

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: "https://oauth2.googleapis.com/token",
  xero: "https://identity.xero.com/connect/token",
};

const USERINFO_ENDPOINTS: Record<string, string> = {
  google: "https://www.googleapis.com/oauth2/v2/userinfo",
  xero: "https://api.xero.com/connections",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { searchParams, origin } = new URL(req.url);
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

  // Exchange code for tokens
  const tokenEndpoint = TOKEN_ENDPOINTS[provider];
  if (!tokenEndpoint) {
    return NextResponse.redirect(`${origin}/integrations?error=unsupported_provider`);
  }

  const clientIdEnv = provider === "google" ? "GOOGLE_CLIENT_ID" : "XERO_CLIENT_ID";
  const clientSecretEnv = provider === "google" ? "GOOGLE_CLIENT_SECRET" : "XERO_CLIENT_SECRET";
  const redirectUri = `${origin}/api/oauth/${provider}/callback`;

  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env[clientIdEnv]!,
      client_secret: process.env[clientSecretEnv]!,
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
  const { access_token, refresh_token, expires_in, scope } = tokens;

  // Get account info
  let accountEmail = "";
  let accountName = "";
  try {
    const userinfoRes = await fetch(USERINFO_ENDPOINTS[provider], {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (userinfoRes.ok) {
      const info = await userinfoRes.json();
      if (provider === "google") {
        accountEmail = info.email || "";
        accountName = info.name || "";
      } else if (provider === "xero") {
        // Xero connections endpoint returns array
        const connections = Array.isArray(info) ? info : [];
        if (connections.length > 0) {
          accountName = connections[0].tenantName || "";
        }
      }
    }
  } catch (e) {
    console.warn("Failed to fetch user info:", e);
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

  // For Google: create TWO integration rows (gmail + google_calendar)
  const providers = provider === "google" ? ["gmail", "google_calendar"] : [provider];

  for (const p of providers) {
    await adminSupabase.from("integrations").upsert(
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
      },
      { onConflict: "client_id,provider" }
    );
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
