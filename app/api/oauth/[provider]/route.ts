import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "crypto";

const OAUTH_CONFIGS: Record<string, { authUrl: string; scopes: string; clientIdEnv: string }> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email openid",
    clientIdEnv: "GOOGLE_CLIENT_ID",
  },
  xero: {
    authUrl: "https://login.xero.com/identity/connect/authorize",
    scopes: "openid profile email accounting.transactions accounting.contacts offline_access",
    clientIdEnv: "XERO_CLIENT_ID",
  },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const config = OAUTH_CONFIGS[provider];

  if (!config) {
    return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

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

  const clientId = process.env[config.clientIdEnv];
  if (!clientId) {
    return NextResponse.json({ error: `${config.clientIdEnv} not configured` }, { status: 500 });
  }

  // CSRF protection
  const state = randomBytes(32).toString("hex");
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/oauth/${provider}/callback`;

  const authParams = new URLSearchParams({
    client_id: clientId,
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
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
