import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getOAuthConfig } from "@/lib/integrations-config";

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  // Get authenticated user
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = user.app_metadata?.client_id;
  if (!clientId) {
    return NextResponse.json({ error: "No client_id" }, { status: 403 });
  }

  const adminSupabase = getSupabase();

  // For Google: disconnect BOTH gmail + google_calendar
  const providers = provider === "google" ? ["gmail", "google_calendar"] : [provider];

  for (const p of providers) {
    // Get current integration to check it exists and belongs to this client
    const { data: integration } = await adminSupabase
      .from("integrations")
      .select("id, access_token_enc")
      .eq("client_id", clientId)
      .eq("provider", p)
      .eq("status", "connected")
      .single();

    if (!integration) continue;

    // Try to revoke the token at the provider (best effort)
    // Look up revoke URL from centralized config; for sub-providers like gmail/google_calendar, also check the parent
    const config = getOAuthConfig(p);
    const revokeUrl = config?.revokeUrl;

    if (revokeUrl && integration.access_token_enc) {
      try {
        const accessToken = decryptToken(integration.access_token_enc);
        await fetch(`${revokeUrl}?token=${accessToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // Revocation failure is non-fatal — clearing tokens is what matters
      }
    }

    // Clear tokens and mark as disconnected
    await adminSupabase
      .from("integrations")
      .update({
        status: "disconnected",
        access_token_enc: null,
        refresh_token_enc: null,
        token_expires_at: null,
        error_message: null,
        error_count: 0,
      })
      .eq("id", integration.id);

    // Log the disconnection
    await adminSupabase.from("integration_sync_logs").insert({
      client_id: clientId,
      integration_id: integration.id,
      sync_type: "disconnect",
      status: "success",
      records_synced: 0,
      metadata: { action: "user_disconnected", provider: p },
    });
  }

  return NextResponse.json({ success: true, provider });
}
