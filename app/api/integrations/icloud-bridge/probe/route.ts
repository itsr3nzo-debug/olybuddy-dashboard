/**
 * POST /api/integrations/icloud-bridge/probe
 *
 * Probe-only endpoint. Customer pastes bridgeUrl + hmacSecret into the form,
 * clicks "Test connection", we HMAC-sign GET /health and return the parsed
 * result (or a typed error code). Does NOT persist anything to Supabase —
 * persistence happens in the sibling POST /api/integrations/icloud-bridge.
 *
 * Auth: dashboard-session via @supabase/ssr cookies. Owner-or-admin scope:
 * we don't allow random tenants probing arbitrary URLs (it's a fetch from
 * our server, so a probe is essentially an SSRF primitive — gate it).
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { probeBridge } from "@/lib/integrations/icloud-bridge/probe";
import { ERROR_COPY } from "@/lib/integrations/icloud-bridge/errors";

async function getSession() {
  const cookieStore = await cookies();
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } },
  );
  const { data: { user } } = await s.auth.getUser();
  return { user };
}

export async function POST(req: NextRequest) {
  const { user } = await getSession();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const bridgeUrl = typeof body.bridgeUrl === "string" ? body.bridgeUrl.trim() : "";
  const hmacSecret = typeof body.hmacSecret === "string" ? body.hmacSecret.trim() : "";
  if (!bridgeUrl || !hmacSecret) {
    return NextResponse.json(
      { ok: false, code: "INVALID_URL", message: "bridgeUrl and hmacSecret required" },
      { status: 400 },
    );
  }

  const result = await probeBridge(bridgeUrl, hmacSecret);
  if (result.ok) {
    return NextResponse.json({ ok: true, health: result.health });
  }
  return NextResponse.json(
    {
      ok: false,
      code: result.code,
      message: result.message ?? ERROR_COPY[result.code ?? "UNEXPECTED"],
      // Surface partial health if we got it — useful for "iCloud not signed in"
      // where the bridge IS up but iCloud isn't yet
      health: result.health,
    },
    { status: 200 },
  );
}
