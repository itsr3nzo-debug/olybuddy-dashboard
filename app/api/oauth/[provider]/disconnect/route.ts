import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabase } from "@/lib/supabase";
import { decryptToken } from "@/lib/encryption";
import { getOAuthConfig } from "@/lib/integrations-config";
import { composio } from "@/lib/composio";

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
    // Fetch ANY row for this client+provider (not just connected — covers
    // expired/error rows the user wants gone too).
    const { data: integration } = await adminSupabase
      .from("integrations")
      .select("id, access_token_enc, metadata")
      .eq("client_id", clientId)
      .eq("provider", p)
      .maybeSingle();

    if (!integration) continue;

    // Revoke at Composio if this was a Composio-managed integration. Without
    // this call the connection lingers in Composio (and counts toward their
    // quota) even after the dashboard thinks it's gone — and the next
    // `initiate` call for the same auth_config would rely on allowMultiple
    // to create yet another orphan. Deleting here keeps Composio in sync.
    const composioId = (integration.metadata as { composio_connected_account_id?: string } | null)?.composio_connected_account_id;
    if (composioId) {
      try {
        await composio.connectedAccounts.delete(composioId);
      } catch (e) {
        console.warn(`[oauth-disconnect] composio delete failed for ${p}/${composioId}:`, e);
        // Non-fatal — DB row is the source of truth for the dashboard.
      }
    }

    // Try to revoke the token at the provider (best effort) — direct-OAuth path.
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

    // Log BEFORE deletion (FK to integrations.id fires on cascade otherwise).
    await adminSupabase.from("integration_sync_logs").insert({
      client_id: clientId,
      integration_id: integration.id,
      sync_type: "disconnect",
      status: "success",
      records_synced: 0,
      metadata: { action: "user_disconnected", provider: p },
    });

    // Hard-delete the row. Keeping a status='disconnected' row was making the
    // integration "reappear" in the UI because fetchIntegrations pulls every
    // row regardless of status — the user had to reload twice to understand
    // why it came back. Tokens are already revoked above, so nothing is lost.
    await adminSupabase
      .from("integrations")
      .delete()
      .eq("id", integration.id);
  }

  return NextResponse.json({ success: true, provider });
}
